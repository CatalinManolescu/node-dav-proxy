/**
 * @author Catalin Manolescu <cc.manolescu@gmail.com>
 * @since 26 September 2012 - 10:49
 */

var url = require('url');
var http = require('http');
var router    = require('router');
var formidable = require("formidable");
var querystring = require('querystring');
var session = require('./session.js');
var proxyUtil = require('./util.js');

var route = router();

function getAuthorization(authToken, method, path, response) {
    return proxyUtil.getDavAuthorization(authToken, response, method, path);
}

function abstractRequest(params, body, callback ) {
    var request = http.request(params, function(response){
        var buffers = [];

        response.addListener('data', function (chunk) {
            buffers.push(chunk);
        });

        response.addListener('end', function () {
            response.content = Buffer.concat(buffers);
            if (callback) {
                callback(null, response);
            }
        });

        response.addListener('error', function(error){
            if (callback) {
                callback(error, response);
            }
        });
    });

    request.addListener('error', function(error){
        if (callback) {
            callback(error, null);
        }
    });

    request.end(body);
}

function isMultiPartRequest(request) {
    var contentType = request.headers['content-type'];
    return !(!contentType || contentType.indexOf("multipart") === -1);
}

function requestHandler(request, response, callback) {
    var requestUrl = url.parse(request.url);

    request.url = requestUrl.pathname;

    var params = querystring.parse(requestUrl.query || null);
    var path = request.params;

    response.authToken = (params['SESSION']) ? session.lookUpBySession(params['SESSION']) : session.lookUpByRequest(request);

    if ( isMultiPartRequest(request) ) {
        var form = new formidable.IncomingForm();
        form.parse(request, function(err, fields, files) {
            request.fields = fields;
            request.files = files;
            // Dispatch the request to the router
            var content = {'fields': fields, 'files': files};

            if (callback) {
                callback(request,response, path, params, content);
            }
        });

    } else {
        var buffers = [];

        request.addListener('data', function (chunk) {
            buffers.push(chunk);

            if (buffers.length > 1e6) {
                // FLOOD ATTACK OR FAULTY CLIENT, NUKE REQUEST
                request.connection.destroy();
            }
        });

        request.addListener('end', function () {
            if (callback) {
                callback(request,response, path, params, Buffer.concat(buffers));
            }
        });
    }
}

var Proxy = function Proxy() {
    var self = this;
};

Proxy.prototype = {
    addRoute: function(method, pattern, callback) {
        route[method](pattern, function(req, res){
            requestHandler(req,res,callback);
        });
    },

    createServer: function(port) {
        http.createServer(route).listen(port);
    },

    respond: function (client, status, headers, body) {
        client.writeHead(status, headers);
        client.end(body);
    },

    request: function(client, params, body, callback) {
        var self = this;

        var responseHandler = function(error, response) {
            if (error) {
                self.respond(client, 500, {'content-type': proxyUtil.CONTENT_TYPE_TEXT}, "error" + "\n" + error);
                return;
            }

            if (callback) {
                callback(response);
            } else {
                self.respond(client, response.statusCode,{"content-type": response.headers['content-type']}, response.content);
            }
        };

        abstractRequest(params, body, function(error, response){

            if (client.authToken && response.statusCode == 401) {
                //authorization requested
                //create authorization and resend the request
                params.headers.authorization = getAuthorization(client.authToken, params.method, params.path, response);
                abstractRequest(params, body, responseHandler);

                return;
            }

            responseHandler(error, response);
        });
    }
}

module.exports = Proxy;