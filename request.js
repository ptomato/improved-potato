/* exported request, RequestError */

const {Soup} = imports.gi;
const ByteArray = imports.byteArray;

class RequestError extends Error {
    constructor(statusCode, response, responseHeaders = {}) {
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
        this.headers = {};
        responseHeaders.foreach((key, value) => (this.headers[key] = value));
    }
}

function request(session, method, url, jsonBody = null, headers = {}, options = {}) {
    const jsonType = options.jsonType || 'application/json';
    const debug = options.debug || false;

    const msg = new Soup.Message({
        method,
        uri: Soup.URI.new(url),
    });

    if (jsonBody) {
        msg.requestHeaders.set_content_type(jsonType, {});
        msg.requestBody.append(ByteArray.fromString(JSON.stringify(jsonBody)));
    }

    Object.entries(headers).forEach(([key, value]) =>
        msg.requestHeaders.append(key, value));

    if (debug) {
        print('--->');
        print(`URL: ${url}`);
        print(JSON.stringify(body, null, 2));
        msg.requestHeaders.foreach((key, value) => print(`${key}=${value}`));
        print('===>');
    }

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

            if (debug) {
                print('<---');
                print(`Code: ${m.statusCode}`);
                print(JSON.stringify(response, null, 2));
                m.responseHeaders.foreach((key, value) => print(`${key}=${value}`));
                print('<===');
            }

            if (m.statusCode !== 200) {
                reject(new RequestError(m.statusCode, response, m.responseHeaders));
                return;
            }
            resolve(response);
        });
    });
}
