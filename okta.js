const System = imports.system;

imports.searchPath.unshift('.');
const {App, AppWindow, DEFAULT_MOOD, LoginWindow} = imports.app;
const {request} = imports.request;

// FIXME: this should be stored securely. (This is a throwaway account.)
const DEVELOPER_TOKEN = '---------------fill me in----------';
const DOMAIN = 'https://dev-209966.oktapreview.com';
const CLIENT_ID = '0oaft2f2uyFld1rJU0h7';

class Client {
    constructor(session) {
        this._session = session;
        this._token = null;
        this._userID = null;
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
            let message = 'Login failed.';
            if ('response' in err && 'errorSummary' in err.response)
                message = `${err.response.errorSummary}.`;
            else if ('message' in err)
                ({message} = err);
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
            let message = 'Create account failed.';
            if ('response' in err && 'errorSummary' in err.response)
                message = `${err.response.errorSummary}.`;
            else if ('message' in err)
                ({message} = err);
            else
                logError(err);
            dialog.createAccountFailed(message);
        }
    }

    async _authenticate(username, password) {
        const body = {
            client_id: CLIENT_ID,
            grant_type: 'password',
            username,
            password,
            scope: 'openid profile',
        };
        const headers = {
            Accept: 'application/json',
        };

        const response = await request(this._session, 'POST',
            `${DOMAIN}/oauth2/default/v1/token`, body, headers, {urlencode: true});
        const {access_token} = response;
        this._token = access_token;

        const {sub} = await request(this._session, 'GET',
            `${DOMAIN}/oauth2/default/v1/userinfo`, null,
            {Authorization: `Bearer ${this._token}`});
        this._userID = sub;
    }

    userProfile() {
        const headers = {
            Accept: 'application/json',
            Authorization: `SSWS ${DEVELOPER_TOKEN}`,
        };
        return request(this._session, 'GET',
            `${DOMAIN}/api/v1/users/${this._userID}`, null, headers);
    }

    async createAccount(username, password) {
        const body = {
            profile: {
                login: username,
                email: `${username}@endlesscode.com`,  // required
                mood: DEFAULT_MOOD,
            },
            credentials: {
                password: {
                    value: password,
                },
            },
        };
        const headers = {
            Accept: 'application/json',
            Authorization: `SSWS ${DEVELOPER_TOKEN}`,
        };

        const {id} = await request(this._session, 'POST',
            `${DOMAIN}/api/v1/users`, body, headers);
        this._userID = id;
    }

    async getUserData() {
        const {profile} = await this.userProfile();
        return profile;
    }

    async setUserData(data) {
        const body = {
            profile: data,
        };
        const headers = {
            Accept: 'application/json',
            Authorization: `SSWS ${DEVELOPER_TOKEN}`,
        };
        await request(this._session, 'POST',
            `${DOMAIN}/api/v1/users/${this._userID}`, body, headers);
    }
}

const theApp = new App();
theApp.connect('activate', async application => {
    const client = new Client(application.session);
    application.hold();
    await client.login();
    const win = new AppWindow({application}, client);
    application.release();
    win.present();
});
theApp.run([System.programInvocationName].concat(ARGV));
