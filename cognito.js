const System = imports.system;

imports.searchPath.unshift('.');
const {App, AppWindow, DEFAULT_MOOD, LoginWindow} = imports.app;
const {request} = imports.request;

const REGION = 'us-east-1';
const IDP_ENDPOINT = `https://cognito-idp.${REGION}.amazonaws.com`;
const CLIENT_ID = '176iih12oa33fo5drpvgrnhh5r';

function amazonRequest(session, operation, body, options) {
    const realOptions = {jsonType: 'application/x-amz-json-1.1'};
    Object.assign(realOptions, options);

    body.Action = operation;
    body.Version = '2016-04-18';
    return request(session, 'POST', IDP_ENDPOINT, body, {
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${operation}`,
        'X-Amz-User-Agent': 'test app js',
    }, realOptions);
}

function _propsToArray(props) {
    return Object.entries(props)
        .map(([key, Value]) => ({Name: `custom:${key}`, Value}));
}

function _arrayToProps(array) {
    const retval = {};
    array.filter(({Name}) => Name.startsWith('custom:'))
        .forEach(({Name, Value}) => {
            retval[Name.slice('custom:'.length)] = Value;
        });
    return retval;
}

class Client {
    constructor(session) {
        this._session = session;
        this._token = null;
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
            if ('response' in err && 'message' in err.response)
                message = `${err.response.message}.`;
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
            if ('response' in err && 'message' in err.response)
                message = `${err.response.message}.`;
            else
                logError(err);
            dialog.createAccountFailed(message);
        }
    }

    async _authenticate(username, password) {
        const body = {
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: CLIENT_ID,
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password,
            },
        };

        const response = await amazonRequest(this._session, 'InitiateAuth', body);
        const {AccessToken} = response.AuthenticationResult;
        this._token = AccessToken;
    }

    userProfile() {
        return amazonRequest(this._session, 'GetUser', {AccessToken: this._token});
    }

    createAccount(username, password) {
        return amazonRequest(this._session, 'SignUp', {
            ClientId: CLIENT_ID,
            Username: username,
            Password: password,
            UserAttributes: [{
                Name: 'custom:mood',
                Value: DEFAULT_MOOD,
            }],
        });
    }

    async getUserData() {
        const response = await this.userProfile();
        const {UserAttributes} = response;
        return _arrayToProps(UserAttributes);
    }

    async setUserData(data) {
        const body = {
            AccessToken: this._token,
            UserAttributes: _propsToArray(data),
        };
        await amazonRequest(this._session, 'UpdateUserAttributes', body);
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
