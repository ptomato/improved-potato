const {GLib} = imports.gi;
const System = imports.system;

imports.searchPath.unshift('.');
const {App, AppWindow, DEFAULT_MOOD, LoginWindow} = imports.app;
const {request} = imports.request;

const DOMAIN = 'https://ptomato.eu.auth0.com';
const FRONTEND_CLIENT_ID = 'UDzkVfzq9pZe2SLLfhek5ZzypdrRMeUB';
const BACKEND_CLIENT_ID = 'vlfEWCiBZt11PSV0eVKAN6rb70GqrBUa';
// FIXME: This should be stored securely. (This is a throwaway account.)
const BACKEND_CLIENT_SECRET =
    '---------------------------------------fill me in-----------------------';

class Login {
    constructor(session) {
        this._session = session;
        this._token = null;
    }

    get _tokenHeader() {
        return {Authorization: `Bearer ${this._token}`};
    }

    login() {
        return new Promise((resolve, reject) => {
            const dialog = new LoginWindow();
            dialog.connect('login', (dialog_, user, pass) => {
                this._onLogin(dialog_, user, pass);  // discard returned Promise
            });
            dialog.connect('create-account', (dialog_, user, pass) => {
                this._onCreateAccount(dialog_, user, pass);
            });
            dialog.connect('destroy', () => resolve());
            dialog.present();
            void reject;  // never rejects, just keeps asking for login
        });
    }

    async _onLogin(dialog, username, password) {
        try {
            await this._authenticate(username, password);
            dialog.loginSucceeded();
        } catch (err) {
            let message;
            if ('response' in err)
                message = err.response.error_description;
            else
                logError(err);
            dialog.loginFailed(message);
        }
    }

    async _onCreateAccount(dialog, username, password) {
        try {
            await this.createAccount(username, password);
            await this._authenticate(username, password);
            dialog.createAccountSucceeded();
        } catch (err) {
            let message;
            if ('response' in err) {
                if ('error_description' in err.response) {
                    message = err.response.error_description;
                } else if ('error' in err.response) {
                    message = err.response.error;
                    message = `${message[0].toUpperCase()}${message.slice(1)}.`;
                } else if ('message' in err.response) {
                    message = `${err.response.message}.`;
                } else {
                    logError(err);
                }
            } else {
                logError(err);
            }
            dialog.createAccountFailed(message);
        }
    }

    async _authenticate(username, password) {
        const url = `${DOMAIN}/oauth/token`;
        const body = {
            client_id: FRONTEND_CLIENT_ID,
            grant_type: 'http://auth0.com/oauth/grant-type/password-realm',
            realm: 'Username-Password-Authentication',
            username,
            password,
        };

        const {access_token} = await request(this._session, 'POST', url, body);
        this._token = access_token;
    }

    userProfile() {
        const url = `${DOMAIN}/userinfo`;
        return request(this._session, 'GET', url, null, this._tokenHeader);
    }

    async createAccount(username, password) {
        const url = `${DOMAIN}/dbconnections/signup`;
        const body = {
            client_id: FRONTEND_CLIENT_ID,
            email: username,
            password,
            connection: 'Username-Password-Authentication',
            user_metadata: {mood: DEFAULT_MOOD},
        };
        await request(this._session, 'POST', url, body);
    }
}

class UserManager {
    constructor(session, userID) {
        this._session = session;
        this._userID = userID;
        this._token = null;
        this._tokenExpirationTime = null;
    }

    get _tokenHeader() {
        return {Authorization: `Bearer ${this._token}`};
    }

    async _ensureAuthenticated() {
        if (this._token !== null &&
            GLib.get_monotonic_time() < this._tokenExpirationTime)
            return;

        const url = `${DOMAIN}/oauth/token`;
        const body = {
            client_id: BACKEND_CLIENT_ID,
            client_secret: BACKEND_CLIENT_SECRET,
            audience: 'https://ptomato.eu.auth0.com/api/v2/',
            grant_type: 'client_credentials',
        };

        const {access_token, expires_in} = await request(this._session, 'POST', url, body);
        this._token = access_token;
        this._tokenExpirationTime = GLib.get_monotonic_time() + expires_in * 1e6;
    }

    async getUserData() {
        await this._ensureAuthenticated();

        const url = `${DOMAIN}/api/v2/users/${this._userID}?fields=user_metadata`;
        const {user_metadata} = await request(this._session, 'GET', url, null,
            this._tokenHeader);
        return user_metadata;
    }

    async setUserData(data) {
        await this._ensureAuthenticated();

        const url = `${DOMAIN}/api/v2/users/${this._userID}`;
        const body = {user_metadata: data};
        return request(this._session, 'PATCH', url, body, this._tokenHeader);
    }
}

const theApp = new App();
theApp.connect('activate', async application => {
    const login = new Login(application.session);
    application.hold();
    await login.login();
    const {sub} = await login.userProfile();
    const userManager = new UserManager(application.session, sub);
    const win = new AppWindow({application}, userManager);
    application.release();
    win.present();
});
theApp.run([System.programInvocationName].concat(ARGV));
