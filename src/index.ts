import { KVNamespace, R2Bucket } from '@cloudflare/workers-types';
import { InstagramAuth, InstagramGraphApi, AccessToken } from './insta';

export interface Env {
	INSTAGRAM_APP_ID: string;
	INSTAGRAM_APP_SECRET: string;
	GALLERY_CONFIG_KEY: string;
	R2_BUCKET_BASE: string;
	INSTA_GALLERY: KVNamespace;
	INSTA_BUCKET: R2Bucket;
}

function getRedirectUri(request: Request): string {
	const url = new URL(request.url);
	let path = url.pathname;

	if (!path.endsWith('/')) {
		path += '/';
	}
	const host = url.host;
	return `https://${host}${path}`;
}

type GalleryEntry = {
	id: string;
	caption: string;
	media_type: string;
	timestamp: string;
	permalink: string;
};

async function downloadImage(env: Env, name: string, url: string): Promise<void> {
	if (!url) {
		return;
	}

	const image = await env.INSTA_BUCKET.head(name);
	if (image) {
		return;
	}

	const response = await fetch(url);
	const buffer = await response.arrayBuffer();
	await env.INSTA_BUCKET.put(name, new Uint8Array(buffer), {
		httpMetadata: { contentType: response.headers.get('content-type') as string },
	});
}

type ErrorResponse = {
	error: string;
	status: number;
};

function getInstaAuth(env: Env, request?: Request): InstagramAuth | ErrorResponse {
	const app_id = env.INSTAGRAM_APP_ID;
	const app_secret = env.INSTAGRAM_APP_SECRET;

	if (!app_id || !app_secret) {
		return { error: 'Keys are not set up', status: 500 };
	}

	const redirect_uri = request ? getRedirectUri(request) : '';
	const insta_auth = new InstagramAuth(app_id, redirect_uri, app_secret);
	return insta_auth;
}

async function retrieveAccessToken(env: Env): Promise<AccessToken | ErrorResponse> {
	const access_token_str = await env.INSTA_GALLERY.get('instagram-access-token');
	if (!access_token_str) {
		return { error: 'Not Authenticated', status: 401 };
	}
	const original_access_token = AccessToken.deserialize(access_token_str);
	if (!original_access_token) {
		return { error: 'Invalid access token', status: 500 };
	}

	const insta_auth = getInstaAuth(env);
	if ('error' in insta_auth) {
		return insta_auth;
	}
	const new_access_token = await insta_auth.refreshLongLivedToken(original_access_token);
	if (!new_access_token) {
		return { error: 'Error refreshing access token', status: 500 };
	}
	return new_access_token;
}

/**
 * Fetch the user's instagram gallery.
 *
 * Run this on a schedule to keep the gallery up to date.
 */
async function fetchUserGallery(env: Env): Promise<null | ErrorResponse> {
	const access_token = await retrieveAccessToken(env);
	if ('error' in access_token) {
		return access_token
	}

	const insta_api = new InstagramGraphApi(access_token);
	const gallery = await insta_api.fetchUserGallery();

	const galleryJson = JSON.stringify(
		gallery.data.map(media => {
			const entry: GalleryEntry = {
				id: media.id,
				caption: media.caption,
				media_type: media.media_type,
				timestamp: media.timestamp,
				permalink: media.permalink,
			};
			return entry;
		})
	);

	//delete all the old images and thumbnails (i.e. all the images that are not in the new gallery)
	const keys = await env.INSTA_BUCKET.list();
	const oldKeys = keys.objects
		.filter((obj: R2Object) => {
			if (obj.key === 'gallery.json') {
				return false;
			}
			const mediaId = obj.key.split('-')[1];
			return !gallery.data.find(media => media.id === mediaId);
		})
		.map((obj: R2Object) => obj.key);
	await Promise.all(oldKeys.map(key => env.INSTA_BUCKET.delete(key)));

	// Fetch each image and thumbnail and store them in the bucket.
	const promises = gallery.data.map(async media => {
		await downloadImage(env, `media-${media.id}`, media.media_url);
		if (media.media_type === 'VIDEO') {
			await downloadImage(env, `thumb-${media.id}`, media.thumbnail_url);
		}
	});

	await Promise.all(promises);

	await env.INSTA_BUCKET.put('gallery.json', galleryJson);
	return null;
}

async function fetchUserGalleryWrapper(env: Env) {
	const result = await fetchUserGallery(env);
	if (result?.error) {
		console.error(result.error);
	}
}

/**
 * Instagram authentication flow.
 */
async function fetchAuth(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const config_key = env.GALLERY_CONFIG_KEY;
	if (!config_key) {
		return new Response('Configuration Key not set up', { status: 500 });
	}

	const insta_auth = getInstaAuth(env, request);
	if ('error' in insta_auth) {
		return new Response(insta_auth.error, { status: insta_auth.status });
	}

	const url = new URL(request.url);
	const queryParams = url.searchParams;

	// if there is a query param for config_key, then we are starting the auth process
	const queryKey = queryParams.get('config_key');
	if (queryKey === config_key) {
		await env.INSTA_GALLERY.delete('auth-state');
		const step1 = insta_auth.startAuth('user_profile,user_media');
		await env.INSTA_GALLERY.put('auth-state', step1.app_state);
		return step1.response;
	}

	// if there is a query param for code, then we are finishing the auth process
	const step2params = insta_auth.parseAuthStep2Params(queryParams);
	if (step2params !== null) {
		if (!(step2params.state === (await env.INSTA_GALLERY.get('auth-state')))) {
			return new Response('Invalid state', { status: 401 });
		}

		const short_token = await insta_auth.getAccessToken(step2params.code);
		await env.INSTA_GALLERY.delete('auth-state');
		await env.INSTA_GALLERY.delete('instagram-access-token');

		if (!short_token) {
			return new Response('Error getting short lived token', { status: 500 });
		}

		const long_token = await insta_auth.getLongLivedToken(short_token);

		if (!long_token) {
			return new Response('Error getting long lived token', { status: 500 });
		}

		await env.INSTA_GALLERY.put('instagram-access-token', long_token.serialize());
		return new Response('Authentication Successful');
	}

	// if there is a query param for error, then the user denied the auth request
	if (queryParams.get('error')) {
		return new Response('User denied access', { status: 401 });
	}
	// otherwise, return a 400
	return new Response('Bad Request', { status: 400 });
}

/**
 * Return true if the auth token is set.
 */
async function isAuthenticated(env: Env): Promise<boolean> {
	return !!(await env.INSTA_GALLERY.get('instagram-access-token'));
}

async function authWelcome(env: Env): Promise<Response> {
	if (await isAuthenticated(env)) {
		var authWarning = `<p>You are already authenticated. If you proceed, old authentication will be lost.</p>`;
	} else {
		var authWarning = '';
	}

	return new Response(
		`
		<html>
			<body>
				<h1>Set Up Instagram Gallery</h1>
				<form action="/auth/" method="GET">
					<label for="config_key">Configuration Key:</label>
					<input type="text" id="config_key" name="config_key">
					<button type="submit">Authenticate with Instagram</button>
					${authWarning}
					<p>The configuration key is the value of the GALLERY_CONFIG_KEY (secret) environment variable.</p>
				</form>
			</body>
		</html>
	`,
		{
			headers: {
				'content-type': 'text/html',
			},
		}
	);
}

/**
 * Basic Rendering of the gallery as a grid of thumbnails.
 *
 * Note: This is not a good way to render a gallery. It is just a simple example.
 */
async function renderGallery(request: Request, env: Env): Promise<Response> {
	const galleryJson = await env.INSTA_BUCKET.get('gallery.json');
	if (!galleryJson) {
		return new Response('Gallery not found', { status: 404 });
	}

	const r2bucket_base = await env.R2_BUCKET_BASE;

	const gallery = (await galleryJson.json()) as GalleryEntry[];
	const thumbnails = gallery.map(media => {
		let thumbUrl = media.media_type === 'VIDEO' ? `thumb-${media.id}` : `media-${media.id}`;
		return `<a href="${media.permalink}"><img src="${r2bucket_base}/${thumbUrl}" alt="${media.caption}"></a>`;
	});

	return new Response(
		`
	<html>
		<head>
			<style>
				.gallery {
					display: grid;
					grid-template-columns: repeat(4, 1fr);
					grid-gap: 10px;
				}
				.gallery img {
					width: 100%;
					aspect-ratio: 1;
				}
				body {
					max-width: 1000px;
					margin: auto;
				}
			</style>
		</head>
		<body>
			<h1>Instagram Gallery</h1>
			<div class="gallery">
				${thumbnails.join('\n')}
			</div>
		</body>
	</html>
`,
		{
			headers: {
				'content-type': 'text/html',
			},
		}
	);
}

async function updateForm(request: Request, env: Env): Promise<Response> {
	if (!(await isAuthenticated(env))) {
		return new Response('Not Authenticated', { status: 401 });
	}

	// if the "config_key" not present, present a form to enter it
	// if the "config_key" is present, check that it is correct and then trigger the update

	const config_key = env.GALLERY_CONFIG_KEY;
	const url = new URL(request.url);
	const queryParams = url.searchParams;
	const queryKey = queryParams.get('config_key');

	if (queryKey) {
		if (queryKey === config_key) {
			const result = await fetchUserGallery(env);
			if (result?.error) {
				return new Response(result.error, { status: result.status });
			} else {
				return new Response('Gallery Updated');
			}
		} else {
			return new Response('Invalid Configuration Key', { status: 401 });
		}
	}

	return new Response(
		`
		<html>
			<body>
				<h1>Update Gallery</h1>
				<form action="/update" method="GET">
					<label for="config_key">Configuration Key:</label>
					<input type="text" id="config_key" name="config_key">
					<button type="submit">Update Gallery</button>
					<p>The configuration key is the value of the GALLERY_CONFIG_KEY (secret) environment variable.</p>
				</form>
			</body>
		</html>
	`,
		{
			headers: {
				'content-type': 'text/html',
			},
		}
	);
}

const handler: ExportedHandler<Env> = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		const path = url.pathname;

		if (path === '/auth/') {
			return fetchAuth(request, env, ctx);
		} else if (path === '/gallery') {
			return renderGallery(request, env);
		} else if (path === '/update') {
			return updateForm(request, env);
		} else if (path === '/') {
			return authWelcome(env);
		} else {
			return new Response('Not Found', { status: 404 });
		}
	},

	async scheduled(event, env: Env, ctx: ExecutionContext) {
		await fetchUserGallery(env);
	},
};

export default handler;
