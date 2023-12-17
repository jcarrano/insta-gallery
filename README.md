# Instagram Gallery View

## Problem Statement

You have an Instagram account and you want to also display your images/videos
on your website.

## Solution

This is a server-side application that produces a gallery view of an user's
Instagram wall. It is an alternative to the official Instagram widget, which
does not allow to customize the view and may be blocked by ad-blockers or Firefox's
tracking protection.

It is a self-hosted alternative to services such as ElecticBlaze (Mobirise),
curator, etc and runs on Cloudflare Workers.

## Limitations

Only one image is shown per album. This is not hard to change, though.

## License and attribution

This project is licensed under the MIT license.

poptrox belongs to user n33 (also MIT license).
All other code is Copyright (C) 2023 Juan Ignacio Carrano.

## How it works

### Instagram API

You will need to get a app ID and secret from Instagram. You can do so by
creating a new app at https://www.instagram.com/developer/clients/manage/

Follow the guide at https://sites.caltech.edu/documents/15223/Setup_Instagram_Basic_Display_API.pdf
and make sure to use the App Id and App Secret fron the "Instagram Basic Display API",
not the Facebook App.

Add your domain to the allowed domains list for authentication.

### Cloudflare Workers

#### Workers KV

You will need to create a new Workers KV namespace and bind it to your worker
as `INSTA_GALLERY`. The following keys will be set by the worker:

- `instagram-access-token`: The long-lived access token
- `instagram-user-id`: The user ID of the Instagram user
- `auth-state`: The state of the authentication process (temporary)

#### R2 Storage

You will need to create a new R2 storage namespace and bind it to your worker
as `INSTA_GALLERY_R2`.

Set the R2 storage to be publicly readable if you want to render the gallery
client-side and add your domain to the CORS list.

#### Environment variables

The following environment variables should be set:

- `INSTAGRAM_APP_ID`: The Instagram app ID.
- `R2_BUCKET_BASE`: (optional) The base URL for the R2 storage bucket. This is
  only used for the basic gallery renderer (the one that is served by the worker).

The following environment variables must be set as secrets:

- `INSTAGRAM_APP_SECRET`: The Instagram app secret.
- `GALLERY_CONFIG_KEY`: a random string used to perform privileged operations
  (authentication and forced update).

#### Worker

The worker is composed of the following paths, plus a scheduled worker:

- `/auth`: serves as a redirect target for Instagram's OAuth flow.
- `/`: Authentication entry point.
- `/gallery`: Simplified gallery view.
- `/update`: Force an update of the gallery.
- Update handler: Updates the gallery (run as a scheduled worker).

In order to authenticate and force an update, you will need provide the config
key.

#### Set up

Update the `wrangler.toml` file with your app ID and, name of the worker, KV
namespace and R2 storage namespace.

Set the INSTAGRAM_APP_SECRET secret and choose a random string for
GALLERY_CONFIG_KEY.

To start the authentication flow, visit `/` and following the instructions.

#### Update the gallery

`wrangler.toml` contains a scheduled worker that will update the gallery every
day at 04:30 UTC. You can change the schedule by editing the corresponding
line.

### Rendering the gallery

The worker exposes a very basic gallery renderer. For more advanced use cases,
write your own renderer and access the data directly from R2.

See the client-side renderer in `example_renderer/`. It uses poptrox to display
the images and videos in a lightbox.
