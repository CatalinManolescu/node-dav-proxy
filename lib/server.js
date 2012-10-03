/**
 * @author Catalin Manolescu <cc.manolescu@gmail.com>
 * @since 26 September 2012 - 10:26
 */

//---------------------------------------
//-------- includes & variables ---------
//---------------------------------------

var Proxy = require('./proxy.js');
var proxyUtil = require('./util.js');
var session = require('./session.js');

var DEFAULT_PORT = 7245;

var webDavHost = 'localhost';
var webDavPort = '80';
var webDavPath = '/';

var crossDomainXml = '\<?xml version="1.0"?>' +
    '\<!DOCTYPE cross-domain-policy SYSTEM "http://www.adobe.com/xml/dtds/cross-domain-policy.dtd">\n' +
    '\<cross-domain-policy\>\n' +
    '\<site-control permitted-cross-domain-policies="all"/>\n' +
    '\<allow-access-from domain="*" secure="false"/>\n' +
    '\<allow-http-request-headers-from domain="*" headers="*" secure="false"/>\n' +
    '\</cross-domain-policy>';


var developmentMode = false;
var postRequestCallback = null;

var proxy = new Proxy();

//---------------------------------------
//------------- helpers -----------------
//---------------------------------------
function getWebDavCommand() {
    return new proxyUtil.WebDavCommand();
}

function getWebDavParams() {
    var params = new proxyUtil.HttpRequestParams();
    params.host = webDavHost;
    params.port = webDavPort;
    params.path = webDavPath;
    return params;
}

function getUploadParams(path,fileName, size) {
    var params = getWebDavParams();
    params.method = 'PUT';
    params.appendPath(path);
    params.appendPath(encodeURI(fileName));

    return params;
}
function getCommandResponseObject(command, path, params, content) {
    var cmd = getWebDavCommand();
    cmd.name = command;
    cmd.path = path;
    cmd.params = params ? params : {};
    cmd.content = content ? content : {};

    return cmd;
}

function notifyPostRequestHandler(command, path, content) {
    if (postRequestCallback) {
        var cmd = getCommandResponseObject(command, path, null, content);
        postRequestCallback(cmd);
    }
}

function updateCookieHeaders(sessionValue){
    return {
        "access-control-allow-origin": '*',
        "access-control-allow-credentials" :true,
        "set-cookie": session.cookieID() + "=" + sessionValue + ';path=/',
        "content-type": proxyUtil.CONTENT_TYPE_TEXT
    };
}

function enableDevelopmentMode(value) {
    developmentMode = value ? true : false;
}

function createSession(userName, password, realm) {
    var token = session.update( { userName: userName, digest: proxyUtil.makePasswordDigest(userName, password, realm) } );

    notifyPostRequestHandler( 'session', '/loginNotification', { userName: token.userName, session: token.session } );
}

function parseCommandResponse(command, path, response, callback) {
    if ( !command ) {
        command = '';
    }

    command = command.toUpperCase();

    switch(command) {
        case "PROPFIND":
            proxyUtil.parsePropFindResponse(path, response, function(resources){
                callback({resources: resources});
            });
            break;
        default:
            callback(null);
            break;
    }
}

//---------------------------------------
//---------- route handlers -------------
//---------------------------------------

function handleCrossDomainXMLRequest(request,response, path, params, data) {
    proxy.respond(response, 200, { 'content-type': proxyUtil.CONTENT_TYPE_XML }, crossDomainXml);
}

function handleLoginNotification(request,response, path, params, data) {
    if (data) {
        var token = session.update(data);

        proxy.respond( response, 200, updateCookieHeaders(token.session), '[DavProxy] Session created for user' + data.userName);
        notifyPostRequestHandler( 'session', '/loginNotification', { userName: token.userName, session: token.session });
    } else {
        proxy.respond(response, 500, {"content-type": proxyUtil.CONTENT_TYPE_TEXT}, '[DavProxy] Invalid login notification');
    }
}

function handleLoadSessionRequest(request,response, path, params, data) {
    if ( !developmentMode ) {
        proxy.respond(response, 500, {"content-type": proxyUtil.CONTENT_TYPE_TEXT}, 'Development mode not enabled');
    } else {
        var userName = params.user ;
        var token = session.lookUpByUserName(userName);

        if (token) {
            proxy.respond( response, 200, updateCookieHeaders(token.session), '[DavProxy] Session loaded for user ' + params.user);
        } else {
            proxy.respond(response,500, {"content-type": proxyUtil.CONTENT_TYPE_TEXT}, 'Specified user is not authenticated');
        }
    }
}


function handleIconsRequest(request,response, path, params, data) {
    var requestParams = getWebDavParams();
    requestParams.path = path[0] ? path[0] : request.url;
    requestParams.method = request.method;
    proxy.request(response, requestParams);
}

function handleUploadRequest(request,response, path, params, data) {
    var fileName = data && data.fields && data.fields.Filename ? data.fields.Filename : null;
    var file = fileName ? data.files[fileName] : null;

    if (file) {
        proxyUtil.readFile(file.path, function(error, content){
            if (error) {
                proxy.respond( response, 500, {"content-type": proxyUtil.CONTENT_TYPE_TEXT}, "Could not read file '" + file.name + "'\n" + error);
            } else {
                var requestParams = getUploadParams(path[1], file.name);
                proxy.request(response, requestParams, content, function(davResponse){
                    proxy.respond(response, davResponse.statusCode,{"content-type": davResponse.headers['content-type']}, davResponse.content);
                    notifyPostRequestHandler(
                        'upload',
                        path[1],
                        {
                            session: response.authToken.session,
                            fileName: file.name,
                            localPath: file.path,
                            url: 'http://' + request.headers.host + path[1] + '/' + encodeURI(file.name)
                        }
                    )
                });
            }
        });
    } else {
        proxy.respond( response, 400, {"content-type": proxyUtil.CONTENT_TYPE_TEXT}, 'Invalid data received');
    }
}

function handleJsonRequest(request,response, path, params, data) {
    var command = JSON.parse(data.toString('utf8'));

    if ( !command || !command.name) {
        proxy.respond(response, 400, {"content-type": proxyUtil.CONTENT_TYPE_TEXT}, "Invalid request data for " + request.url);
        return;
    }
    var requestParams = getWebDavParams();
    requestParams.appendPath(path[1]);
    requestParams.method = command.name;

    var headers = command.params ? command.params : {};
    for (var key in headers) {
        requestParams.headers[key] = headers[key];
    }

    var body = null;

    if (command.content) {
        if (command.name === 'PUT') {
            body = new Buffer(command.content, 'base64');
        } else {
            body = command.content;
        }
    }

    proxy.request(response, requestParams, body, function(davResponse){
        var responseBody = null;
        var error = null;
        var responseCode = davResponse.statusCode;

        if ( responseCode == 200 || responseCode == 201 || responseCode == 202 || responseCode == 204 || responseCode == 207) {
            //make response body based on command
            responseBody = davResponse.content.toString();
            //console.log(responseBody);
        } else {
            //error
            error = davResponse.content.toString();
        }

        var commandResponse = getCommandResponseObject(command.name, path[1], command.params, responseBody);
        commandResponse.status = responseCode;
        commandResponse.error = error;

        if ( !error ) {
            parseCommandResponse(command.name, requestParams.path, responseBody, function(content) {
                commandResponse.content = content ? content : {};
            });
        }

        proxy.respond(response, davResponse.statusCode, {"content-type": proxyUtil.CONTENT_TYPE_JSON}, commandResponse.toString());
    });
}

function handleAllRequest(request,response, path, params, data) {

    if (request.method === 'POST') {
        request.method = 'PUT';
    }

    //fwd request to webdav
    var requestParams = getWebDavParams();
    requestParams.appendPath(path[1]);
    requestParams.method = request.method;

    proxy.request(response, requestParams, data);
}

function handleAllTest(request,response, path, params, data, authToken) {
    response.writeHead(200, { 'content-type': 'text/plain;charset=utf-8' });
    response.end('path: ' + JSON.stringify(path) +
        '\nparams: ' + JSON.stringify(params) +
        '\ndata: ' + data.toString() +
        '\nauth: ' + JSON.stringify(authToken));
}

//---------------------------------------
//----------- manage routes -------------
//---------------------------------------
proxy.addRoute('get',/^\/icons(.*)$/, handleIconsRequest);
proxy.addRoute('get','/favicon.ico', handleIconsRequest);
proxy.addRoute('get','/crossdomain.xml', handleCrossDomainXMLRequest);
proxy.addRoute('post','/loginNotification', handleLoginNotification);
proxy.addRoute('get','/loadSession', handleLoadSessionRequest);
proxy.addRoute('post',/^\/upload(.*)$/, handleUploadRequest); //handle multipart post
proxy.addRoute('all',/^\/json(.*)$/, handleJsonRequest);
proxy.addRoute('all',/(.*)$/, handleAllRequest);

//---------------------------------------
//------------ initialize ---------------
//---------------------------------------

function init(davHost, davPort, davPath, sessionID, proxyPort, postRequestHandler) {
    if ( !davHost) {
        console.log('WebDav host not set');
        process.exit(1);
    }

    if ( !davPort) {
        console.log('WebDav port not set');
        process.exit(1);
    }

    if (!davPath) {
        davPath = '/';
    }

    if ( davPath.charAt(0) !== '/' ) {
        davPath = '/' + davPath;
    }

    if ( sessionID ) {
        session.sessionPadding(sessionID);
    }

    if (!proxyPort) {
        proxyPort = DEFAULT_PORT;
    }

    if (postRequestHandler) {
        postRequestCallback = postRequestHandler;
    }

    webDavHost = davHost;
    webDavPort = davPort;
    webDavPath = davPath;

    proxy.createServer(proxyPort);
}


module.exports.init = init;
module.exports.enableDevelopmentMode = enableDevelopmentMode;
module.exports.createSession = createSession;
