// Some instagram api call, with typescript:

const INSTA_API_VERSION = 'v18.0';
const INSTA_GRAPH_URL = `https://graph.instagram.com/${INSTA_API_VERSION}`;

type AuthStep1 = {
	response: Response;
	app_state: string;
};

type AuthStep2Params = {
	code: string;
	state: string;
};

type ShortAccessToken = string;

type ShortAccessTokenResponseR = {
	access_token: string;
	user_id: number;
};

type AccessTokenResponseR = {
	access_token: string;
	token_type: string;
	expires_in: number;
};

class AccessToken {
	access_token: string;
	token_type: string;
	expires_at: Date;

	constructor(access_token: string, token_type: string, expires_at: Date) {
		this.access_token = access_token;
		this.token_type = token_type;
		this.expires_at = expires_at;
	}

	isExpired(): boolean {
		return this.expires_at < new Date();
	}

	closeToExpiry(days_before: number): boolean {
		const d = new Date(this.expires_at);
		d.setDate(d.getDate() - days_before);
		return d < new Date();
	}

	serialize(): string {
		return JSON.stringify({
			access_token: this.access_token,
			token_type: this.token_type,
			expires_at: this.expires_at.toISOString(),
		});
	}

	static deserialize(s: string): AccessToken | null {
		const obj = JSON.parse(s);

		if (typeof obj.expires_at !== 'string') {
			console.log('Invalid expires_at:', obj.expires_at);
			return null;
		}
		if (typeof obj.access_token !== 'string') {
			console.log('Invalid access_token:', obj.access_token);
			return null;
		}
		if (typeof obj.token_type !== 'string') {
			console.log('Invalid token_type:', obj.token_type);
			return null;
		}

		return new AccessToken(obj.access_token, obj.token_type, new Date(obj.expires_at));
	}

	static fromResponse(r: AccessTokenResponseR): AccessToken {
		return new AccessToken(
			r.access_token,
			r.token_type,
			new Date(Date.now() + r.expires_in * 1000)
		);
	}
}

async function get_body_as_json<RType>(response: Response): Promise<RType | null> {
	const response_obj = await response.json();

	if (!response.ok) {
		console.log('Error:', response.status, response_obj);
		return null;
	}

	return response_obj as RType;
}

class InstagramAuth {
	private client_id: string;
	private redirect_uri: string;
	private app_secret: string;

	constructor(client_id: string, redirect_uri: string, app_secret: string) {
		this.client_id = client_id;
		this.redirect_uri = redirect_uri;
		this.app_secret = app_secret;
	}

	/**
	 * Start the oauth flow by redirecting the user to instagram.
	 *
	 * Store the app state in the KV store, so that we can verify it later.
	 *
	 * @param {*} scope e.g. 'user_profile,user_media'
	 *
	 * @returns A Response object that redirects the user to instagram and
	 *          the app state code.
	 */
	startAuth(scope: string): AuthStep1 {
		const app_state =
			Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

		const url = `https://www.instagram.com/oauth/authorize?client_id=${this.client_id}&redirect_uri=${this.redirect_uri}&scope=${scope}&response_type=code&state=${app_state}`;

		return {
			response: Response.redirect(url, 302),
			app_state: app_state,
		};
	}

	/**
	 * Parse the query parameters from the redirect url.
	 */
	parseAuthStep2Params(queryParams: URLSearchParams): AuthStep2Params | null {
		const code = queryParams.get('code');
		const state = queryParams.get('state');

		if (!code || !state) {
			return null;
		}

		return {
			code: code,
			state: state,
		};
	}

	/**
	 * Get an access token from instagram, using the code obtained from the first
	 * step of the oauth flow.
	 *
	 * Before calling this method, you should make sure that the state returned
	 * from the first step matches the state you sent.
	 *
	 * @param {*} code  The code obtained from the first step of the oauth flow.
	 * @returns The access token.
	 */
	async getAccessToken(code: string): Promise<ShortAccessToken | null> {
		const url = `https://api.instagram.com/oauth/access_token`;
		const body = `client_id=${this.client_id}&client_secret=${this.app_secret}&grant_type=authorization_code&redirect_uri=${this.redirect_uri}&code=${code}`;

		const response = await fetch(url, {
			method: 'POST',
			body: body,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
		});

		const short_tokenR = await get_body_as_json<ShortAccessTokenResponseR>(response);
		if (!short_tokenR) {
			return null;
		}

		return short_tokenR.access_token;
	}

	/**
	 * Exchange the access token for a long lived token.
	 *
	 * @param {*} access_token  The access token obtained from the second step of
	 *                         the oauth flow or any other short lived token.
	 *
	 * @returns The long lived token.
	 */
	async getLongLivedToken(access_token: ShortAccessToken): Promise<AccessToken | null> {
		const url = `${INSTA_GRAPH_URL}/access_token?grant_type=ig_exchange_token&client_secret=${this.app_secret}&access_token=${access_token}`;

		const response = await fetch(url, {
			method: 'GET',
		});

		const json = await get_body_as_json<AccessTokenResponseR>(response);
		if (!json) {
			return null;
		}
		return AccessToken.fromResponse(json);
	}

	/**
	 * Refresh the long lived token.
	 *
	 * The token is only refreshed if it is one month away from expiring.
	 *
	 * @param {*} access_token  The long lived token.
	 */
	async refreshLongLivedToken(access_token: AccessToken): Promise<AccessToken | null> {
		if (!access_token.closeToExpiry(30)) {
			return access_token;
		}

		console.log('Token close to expiry, refreshing...');
		const url = `${INSTA_GRAPH_URL}/refresh_access_token?grant_type=ig_refresh_token&access_token=${access_token.access_token}`

		const response = await fetch(url, {
			method: 'GET',
		});

		const json = await get_body_as_json<AccessTokenResponseR>(response);
		if (!json) {
			return null;
		}
		return AccessToken.fromResponse(json);
	}
}

type MediaType = 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';

type BaseFields = {
	id: string;
	timestamp: string;
	permalink: string;
	media_url: string;
};

type MediaImage = {
	media_type: 'IMAGE';
} & BaseFields;

type MediaVideo = {
	media_type: 'VIDEO';
	thumbnail_url: string;
} & BaseFields;

type MediaCarousel = {
	media_type: 'CAROUSEL_ALBUM';
} & BaseFields;

type Media = MediaImage | MediaVideo | MediaCarousel;

type MediaEntry = {
	caption: string;
} & Media;

type MediaResponse = {
	data: MediaEntry[];
	paging: {
		cursors: {
			before: string;
			after: string;
		};
		next: string;
	};
};

class InstagramGraphApi {
	private access_token: string;

	constructor(access_token: AccessToken) {
		this.access_token = access_token.access_token;
	}

	/**
	 * Fetch the user's instagram gallery.
	 */
	async fetchUserGallery(): Promise<MediaResponse> {
		const url = `${INSTA_GRAPH_URL}/me/media?fields=id,caption,media_type,media_url,thumbnail_url,timestamp,permalink&access_token=${this.access_token}`;

		const response = await fetch(url);
		const json = await response.json();

		return json as MediaResponse;
	}

	/**
	 * Fetch a carousel album.
	 */
	async fetchCarousel(id: string): Promise<Media[]> {
		const url = `${INSTA_GRAPH_URL}/${id}/children?fields=id,media_type,media_url,thumbnail_url,timestamp,permalink&access_token=${this.access_token}`;

		const response = await fetch(url);
		const json = (await response.json()) as any;

		return json.data as Media[];
	}
}

export { InstagramAuth, InstagramGraphApi, AccessToken };
