/**
 * @author Catalin Manolescu <cc.manolescu@gmail.com>
 * @since 05 September 2012 - 10:50
 */

var http    = require('http');
var journey = require('journey');
var formidable = require("formidable");
var webDav  = require('./transport.js');
var proxyUtil = require('./util.js');
var session = require('./session.js');

var DEFAULT_PORT = 7245;

var server = null;
var postRequestCallback = null;
var webDavHost = 'localhost';
var webDavPort = '80';
var webDavPath = '/';

function getWebDavParams() {
    var params = new proxyUtil.HttpRequestParams();
    params.host = webDavHost;
    params.port = webDavPort;
    params.path = webDavPath;
    return params;
}

function getWebDavCommand() {
    return new proxyUtil.WebDavCommand();
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

function getCrossDomainXML(request, response) {
    var crossDomainXml = '\<?xml version="1.0"?>' +
        '\<!DOCTYPE cross-domain-policy SYSTEM "http://www.adobe.com/xml/dtds/cross-domain-policy.dtd">\n' +
        '\<cross-domain-policy\>\n' +
        '\<site-control permitted-cross-domain-policies="all"/>\n' +
        '\<allow-access-from domain="*" secure="false"/>\n' +
        '\<allow-http-request-headers-from domain="*" headers="*" secure="false"/>\n' +
        '\</cross-domain-policy>';
    response.send(200, {"Content-Type":"application/xml"}, crossDomainXml);
}

function loginNotification(request, response, data) {
    if (data) {
        var token = session.update(data);
        //var origin = (request.headers.origin || "*");

        response.send(
            200,
            {
                "access-control-allow-origin": '*',
                "access-control-allow-credentials" :true,
                "Set-Cookie": session.cookieID() + "=" + token.session + ';path=/',
                "Content-Type": proxyUtil.CONTENT_TYPE_TEXT
            },
            '[DavProxy] Session created for user' + data.userName);

        notifyPostRequestHandler(
            'session',
            '/loginNotification',
            {
                userName: token.userName,
                session: token.session
            }
        )
    } else {
        response.send(500, {"Content-Type": proxyUtil.CONTENT_TYPE_TEXT}, '[DavProxy] Invalid login notification');
    }
}

function download(request, response, path, data) {
    var params = getWebDavParams();
    params.appendPath(path);
    params.method = 'GET';

    var token = (data && data['SESSION']) ? session.lookUpBySession(data['SESSION']) : session.lookUpByRequest(request);

    webDav.send(token, params, response,
        function(wdRequest){
            wdRequest.end();
        }, function(wdResponse, body){
            response.send(wdResponse.statusCode,{"Content-Type": wdResponse.headers['content-type']}, body);

            if (response.statusCode === 200 || response.statusCode === 201) {
                notifyPostRequestHandler('download', path);
            }
        });
}

function upload(request, response, path, data) {
    //data = JSON.parse(data);
    var fileName = request.fields.Filename;
    var fileDescriptor = request.files[fileName];

    var params = getWebDavParams();
    params.appendPath(path);
    params.appendPath(fileDescriptor.name);
    params.method = 'PUT';

    params.headers.title = fileDescriptor.name;

    var token = session.lookUpByUserName('demo');
    //lookUpByRequest(request);

    webDav.send(token, params, response,
        function(wdRequest){
            proxyUtil.readFile(fileDescriptor.path, function(error, content){
                if(error) {
                    response.send(500, {"Content-Type": proxyUtil.CONTENT_TYPE_TEXT}, "error" + "\n" + error);
                } else {
                    wdRequest.end(content);
                }
            });
        }, function(wdResponse, body){
            response.send(wdResponse.statusCode,{"Content-Type": wdResponse.headers['content-type']}, body);

            if (response.statusCode === 200 || response.statusCode === 201) {
                notifyPostRequestHandler(
                    'upload',
                    path + '/' + fileDescriptor.name,
                    {
                        fileName: fileDescriptor.name,
                        path: fileDescriptor.path
                    }
                )
            }
        });
}

function proxyCommand(request, response, path, data) {
    var command = JSON.parse(request.content);
    console.log(command);

    if ( !command || !command.name) {
        response.send(500, {"Content-Type": proxyUtil.CONTENT_TYPE_TEXT}, "Invalid request data for " + request.url);
    }
    var token = (data && data['SESSION']) ? session.lookUpBySession(data['SESSION']) : session.lookUpByRequest(request);


    var params = getWebDavParams();
    params.appendPath(path);
    params.method = command.name;


    var headers = command.params ? command.params : {};
    for (var key in headers) {
        params.headers[key] = headers[key];
    }

    console.log('Forward request to webdav');
    webDav.send(token, params, response,
        function(wdRequest){
            wdRequest.end();
        }, function(wdResponse, body){
            var responseBody = null;
            var error = null;
            var responseCode = wdResponse.statusCode;

            if ( responseCode == 200 || responseCode == 201 || responseCode == 202 || responseCode == 204 || responseCode == 207) {
                //make response body based on command
                responseBody = body;
            } else {
                //error
                error = body;
            }

            var commandResponse = getCommandResponseObject(command.name, path, command.params, responseBody);
            commandResponse.status = responseCode;
            commandResponse.error = error;

            if ( !error ) {
                parseCommandResponse(command.name, params.path, responseBody, function(data) {
                    commandResponse.content = data ? data : {};
                    response.send(wdResponse.statusCode,{"Content-Type": proxyUtil.CONTENT_TYPE_JSON}, commandResponse.toString());
                });
            } else {
                response.send(wdResponse.statusCode,{"Content-Type": proxyUtil.CONTENT_TYPE_JSON}, commandResponse.toString());
            }
        });

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

// ========================================
// ============= http routing =============
// ========================================

var router = new(journey.Router);

// Create the routing table
router.map(function () {
    this.get('/crossdomain.xml').bind(getCrossDomainXML);
    this.post('/loginNotification').bind(loginNotification);
    this.get(/^wdproxy(.*)$/).bind(download);
    this.post(/^wdproxy(\/.*)?$/).bind(upload);
    this.post(/^wdproxy-command(\/.*)?$/).bind(proxyCommand);
});

function isMultiPartRequest(request) {
    var contentType = request.headers['content-type'];
    return !(!contentType || contentType.indexOf("multipart") === -1);
}

function dispatchRequest(request, response, body) {
    request.content = body;
    router.handle(request, body, function (result) {
        response.writeHead(result.status, result.headers);
        response.end(result.body);
        //console.log(result);
    });
}

function requestListener(request, response) {
    request.headers.accept = "*/*"; //hack for IE9

    if ( isMultiPartRequest(request) ) {
        var form = new formidable.IncomingForm();
        form.parse(request, function(err, fields, files) {
            request.fields = fields;
            request.files = files;
            // Dispatch the request to the router
            var content = {'fields': fields, 'files': files};

            dispatchRequest(request,response, content);
        });

    } else {
        var body = "";

        request.addListener('data', function (chunk) {
            body += chunk;

            if (body.length > 1e6) {
                // FLOOD ATTACK OR FAULTY CLIENT, NUKE REQUEST
                request.connection.destroy();
            }
        });

        request.addListener('end', function () {
            // Dispatch the request to the router
            dispatchRequest(request,response, body);
        });
    }
}

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

    server = http.createServer(requestListener);
    server.listen(proxyPort);
}

module.exports.init = init;
module.exports.createSession = function(userName, password, realm) {
    var token = session.update(
        {
            userName: userName,
            digest: proxyUtil.makePasswordDigest(userName, password, realm)
        }
    );

    notifyPostRequestHandler(
        'session',
        '/loginNotification',
        {
            userName: token.userName,
            session: token.session
        }
    );


}