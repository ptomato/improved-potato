To Run
======

auth0
-----
- Fill in the Client Secret in auth0.js
- `meson _build`
- `ninja -C _build app.gresource`
- `gjs auth0.js`

cognito
-------
- `meson _build`
- `ninja -C _build app.gresource`
- `gjs cognito.js`

okta
----
- Fill in the developer API key in okta.js
- `meson _build`
- `ninja -C _build app.gresource`
- `gjs okta.js`
