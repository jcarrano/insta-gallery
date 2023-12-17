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

type AccessTokenResponse = {
	access_token: string;
	user_id: string;
};

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
	async getAccessToken(code: string): Promise<AccessTokenResponse> {
		const url = `https://api.instagram.com/oauth/access_token`;
		const body = `client_id=${this.client_id}&client_secret=${this.app_secret}&grant_type=authorization_code&redirect_uri=${this.redirect_uri}&code=${code}`;

		const response = await fetch(url, {
			method: 'POST',
			body: body,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
		});

		const json = await response.json();
		const accessTokenResponse = json as AccessTokenResponse;

		return accessTokenResponse;
	}

	/**
	 * Exchange the access token for a long lived token.
	 *
	 * @param {*} access_token  The access token obtained from the second step of
	 *                         the oauth flow or any other short lived token.
	 *
	 * @returns The long lived token.
	 */
	async getLongLivedToken(access_token: string): Promise<AccessTokenResponse> {
		const url = `${INSTA_GRAPH_URL}/access_token?grant_type=ig_exchange_token&client_secret=${this.app_secret}&access_token=${access_token}`;

		const response = await fetch(url, {
			method: 'GET',
		});

		const json = await response.json();
		const accessTokenResponse = json as AccessTokenResponse;

		return accessTokenResponse;
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

	constructor(access_token: string) {
		this.access_token = access_token;
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

export { InstagramAuth, InstagramGraphApi };
