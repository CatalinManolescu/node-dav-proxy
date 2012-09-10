/**
 * @author Catalin Manolescu <cc.manolescu@gmail.com>
 * @since 05 September 2012 - 12:19
 */

var http = require('http');
var proxyUtil = require('./util.js');

function send(authToken, params, client, onCall ,responseCallback) {

    var onError = function(error) {
        // Send error to original client
        client.send(500, {"Content-Type": proxyUtil.CONTENT_TYPE_TEXT}, "error" + "\n" + error);
    };

    if ( !authToken || !authToken.digest) {
        //not authenticated
        client.send(401, {"Content-Type": proxyUtil.CONTENT_TYPE_TEXT}, '[DavProxy] Not authenticated');
        return ;
    }

    //first request to get auth data needed for digest
    abstractRequest(
        params,
        onError,
        function(authResponse){
            params = buildRequestParams(authToken, params,authResponse);
            abstractRequest(
                params,
                onError,
                function(response,body){
                    // Send response to original client
                    client.send(response.statusCode,{"Content-Type": response.headers['content-type']}, body);
                    if (responseCallback) {
                        responseCallback(response, body);
                    }
                },
                onCall);
        },
        function(authRequest){
            authRequest.end();
        });
}

function abstractRequest(params, onerror, responseCallback, oncall ) {
    var request = http.request(params, function(response){
        response.setEncoding('utf8');
        var body = "";

        response.addListener('data', function (chunk) {
            body += chunk;
        });

        response.addListener('end', function () {
            if (responseCallback) {
                responseCallback(response, body);
            }
        });

        response.addListener('error', function(error){
            if (onerror) {
                onerror(error);
            }
        });
    });

    request.addListener('error', function(error){
        if (onerror) {
            onerror(error);
        }
    });

    if (oncall) {
        oncall(request);
    } else {
        request.end();
    }

}

function buildRequestParams(authToken, params, davResponse) {
    params.headers.authorization = proxyUtil.getDavAuthorization(authToken, davResponse, params.method, params.path);
    return params;
}

module.exports.send = send;