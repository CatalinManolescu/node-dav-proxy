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
var fs = require('fs');

var DEFAULT_PORT = 7245;

var server = null;
var afterRequest_handler = null;
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
    } else {
        response.send(500, {"Content-Type": proxyUtil.CONTENT_TYPE_TEXT}, '[DavProxy] Invalid login notification');
    }
}

function download(request, response, path) {
    var params = getWebDavParams();
    params.appendPath(path);
    params.method = 'GET';

    var token = session.lookUpByRequest(request);
    webDav.send(token, params, response,
        function(wdRequest){
            wdRequest.end();
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

    var token = session.lookUpByRequest(request);

    webDav.send(token, params, response,
        function(wdRequest){
            proxyUtil.readFile(fileDescriptor.path, function(error, content){
                if(error) {
                    response.send(500, {"Content-Type": proxyUtil.CONTENT_TYPE_TEXT}, "error" + "\n");
                } else {
                    wdRequest.write(content, "binary");
                    wdRequest.end();
                }
            });
        });
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
});

function isMultiPartRequest(request) {
    var contentType = request.headers['content-type'];
    return !(!contentType || contentType.indexOf("multipart") === -1);
}

function dispatchRequest(request, response, body) {
    router.handle(request, body, function (result) {
        response.writeHead(result.status, result.headers);
        response.end(result.body);
        console.log(result);
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
            var content = new Buffer({'fields': fields, 'files': files}, 'utf8');

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

function init(davHost, davPort, davPath, sessionID, proxyPort, requestEndListener) {
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

    if (requestEndListener) {
        afterRequest_handler = requestEndListener;
    }

    webDavHost = davHost;
    webDavPort = davPort;
    webDavPath = davPath;

    server = http.createServer(requestListener);
    server.listen(proxyPort);

    demoAuthEnable();
}

module.exports.init = init;

//set demo user
function demoAuthEnable() {
    session.update(
        {
            userName: 'demo',
            digest: proxyUtil.makePasswordDigest('demo', 'demo', 'WebDAV')
        }
    );
}