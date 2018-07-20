const {Gio, GLib, GObject, Gtk, Soup} = imports.gi;
const ByteArray = imports.byteArray;
const System = imports.system;

const resource = Gio.Resource.load('_build/app.gresource');
Gio.resources_register(resource);

const DOMAIN = 'https://ptomato.eu.auth0.com';
const FRONTEND_CLIENT_ID = 'UDzkVfzq9pZe2SLLfhek5ZzypdrRMeUB';
const BACKEND_CLIENT_ID = 'vlfEWCiBZt11PSV0eVKAN6rb70GqrBUa';
// FIXME: This should be stored securely. (This is a throwaway account.)
const BACKEND_CLIENT_SECRET =
    '---------------------------------------fill me in-----------------------';

const MOODS = [
    'joyous',
    'ineffable',
    'grumpy',
    'hangry',
    'zen',
];
const DEFAULT_MOOD = 'joyous';
const MOOD_DISPLAY_STRING = {
    joyous: 'Joyous',
    ineffable: 'Ineffable',
    grumpy: 'Grumpy',
    hangry: 'Hangry',
    zen: 'Zen',
    unknown: '',
};
const MOOD_DISPLAY_EMOJI = {
    joyous: '😄',
    ineffable: '😶',
    grumpy: '😾',
    hangry: '😡🍕',
    zen: '😌',
    unknown: '…',
};

class RequestError extends Error {
    constructor(statusCode, response) {
        let message = response;
        if (typeof response === 'object') {
            if ('error_description' in response)
                message = response.error_description;
            else if ('message' in response)
                ({message} = response);
            else
                message = JSON.stringify(response);
        }
        super(message);
        this.code = statusCode;
        this.response = response;
    }
}

function request(session, method, url, jsonBody = null, headers = {}) {
    const msg = new Soup.Message({
        method,
        uri: Soup.URI.new(url),
    });

    if (jsonBody) {
        msg.requestHeaders.set_content_type('application/json', {});
        msg.requestBody.append(ByteArray.fromString(JSON.stringify(jsonBody)));
    }

    Object.entries(headers).forEach(([key, value]) =>
        msg.requestHeaders.append(key, value));

    return new Promise((resolve, reject) => {
        session.queue_message(msg, (s, m) => {
            const responseBytes = m.responseBody.flatten().get_data();
            let response = responseBytes.toString();

            try {
                response = JSON.parse(response);
            } catch (e) {
                if (e.name !== 'SyntaxError')
                    throw e;
                // ignore JSON parse errors and just return the response as a
                // string, instead
            }

            if (m.statusCode !== 200) {
                reject(new RequestError(m.statusCode, response));
                return;
            }
            resolve(response);
        });
    });
}

const LoginWindow = GObject.registerClass({
    GTypeName: 'LoginWindow',
    Template: 'resource:///app/login.ui',
    InternalChildren: ['account-create', 'account-error-message',
        'account-error-revealer', 'account-password', 'account-username',
        'login', 'login-error-message', 'login-error-revealer',
        'login-password', 'login-username'],
    Signals: {
        login: {
            param_types: [String, String],
        },
        'create-account': {
            param_types: [String, String],
        },
    },
}, class LoginWindow extends Gtk.Window {
    _init(props = {}) {
        super._init(props);
        this._login.connect('clicked', this._onLogin.bind(this));
        this._account_create.connect('clicked', this._onAccountCreate.bind(this));
    }

    _onLogin(button) {
        button.sensitive = false;
        const username = this._login_username.text;
        const password = this._login_password.text;
        this.emit('login', username, password);
    }

    _onAccountCreate(button) {
        button.sensitive = false;
        const username = this._account_username.text;
        const password = this._account_password.text;
        this.emit('create-account', username, password);
    }

    loginFailed(err) {
        let message = 'Failed to log in.';
        if ('response' in err)
            message = err.response.error_description;
        else
            logError(err);

        this._login_username.text = '';
        this._login_password.text = '';
        this._login.sensitive = true;
        this._login_error_message.label = `${message} Try again.`;
        this._login_error_revealer.reveal_child = true;
    }

    loginSucceeded() {
        this.destroy();
    }

    createAccountFailed(err) {
        let message = 'Failed to create account.';
        print(Object.keys(err));
        print(Object.keys(err.response));
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

        this._account_username.text = '';
        this._account_password.text = '';
        this._account_create.sensitive = true;
        this._account_error_message.label = `${message} Try again.`;
        this._account_error_revealer.reveal_child = true;
    }

    createAccountSucceeded() {
        this.destroy();
    }
});

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
            dialog.loginFailed(err);
        }
    }

    async _onCreateAccount(dialog, username, password) {
        try {
            await this.createAccount(username, password);
            await this._authenticate(username, password);
            dialog.createAccountSucceeded();
        } catch (err) {
            dialog.createAccountFailed(err);
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

const AppWindow = GObject.registerClass({
    GTypeName: 'AppWindow',
    Template: 'resource:///app/app.ui',
    InternalChildren: ['mood-chooser', 'mood-emoji', 'mood-label',
        'mood-spinner', 'mood-stack'],
}, class AppWindow extends Gtk.ApplicationWindow {
    _init(props = {}, userID) {
        super._init(props);
        this._busy = false;
        this._mood = 'unknown';

        MOODS.forEach(id => this._mood_chooser.append(id, MOOD_DISPLAY_STRING[id]));
        this._mood_chooser.connect('changed', () => {
            this._onMoodChooserChanged();  // discard returned Promise
        });

        this._userManager = new UserManager(this.application.session, userID);

        this._populateUI();
    }

    get busy() {
        return this._busy;
    }

    set busy(value) {
        this._mood_stack.visible_child_name = value ? 'spinner' : 'emoji';
        this._mood_spinner.active = value;
        this._mood_chooser.sensitive = !value;
        this._busy = value;
    }

    get mood() {
        return this._mood;
    }

    set mood(value) {
        this._mood_emoji.label = MOOD_DISPLAY_EMOJI[value];
        this._mood_label.label = `Your mood is: <b>${MOOD_DISPLAY_STRING[value]}</b>`;
        this._mood_chooser.active = MOODS.indexOf(value);
        this._mood = value;
    }

    async _populateUI() {
        this.busy = true;
        try {
            let userData = await this._userManager.getUserData();

            if (!userData || !('mood' in userData) || !MOODS.includes(userData.mood)) {
                userData = {mood: DEFAULT_MOOD};
                await this._userManager.setUserData(userData);
            }

            const {mood} = userData;
            this.mood = mood;
        } catch (e) {
            logError(e, JSON.stringify(e.response, null, 2));
        } finally {
            this.busy = false;
        }
    }

    async _onMoodChooserChanged() {
        const newMood = MOODS[this._mood_chooser.active];
        if (this.mood === newMood)
            return;

        this.busy = true;
        try {
            await this._userManager.setUserData({mood: newMood});
            this.mood = newMood;
        } catch (e) {
            logError(e);
        } finally {
            this.busy = false;
        }
    }
});

const App = GObject.registerClass(class App extends Gtk.Application {
    _init(props = {}) {
        super._init(props);
        this._session = null;
    }

    vfunc_startup() {
        super.vfunc_startup();
        this._session = new Soup.Session();
    }

    async vfunc_activate() {
        super.vfunc_activate();
        const login = new Login(this.session);
        this.hold();
        await login.login();
        const {sub} = await login.userProfile();
        const win = new AppWindow({application: this}, sub);
        this.release();
        win.present();
    }

    get session() {
        return this._session;
    }
});

const theApp = new App();
theApp.run([System.programInvocationName].concat(ARGV));
