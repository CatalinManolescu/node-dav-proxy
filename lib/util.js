/**
 * @author Catalin Manolescu <cc.manolescu@gmail.com>
 * @since 05 September 2012 - 12:34
 */

var fs = require('fs');
var crypto = require('crypto');
var qs = require('querystring');

function HttpRequestParams() {
    this.host = 'localhost';
    this.port = '80';
    this.path = '/';
    this.method = 'GET';
    this.headers = {};

    this.appendPath = function(value) {
        if ( !value ) return;

        if (value.charAt(0) !== '/') {
            this.path += "/";
        }
        this.path += encodeURI(value);
    }

    this.fullPath = function () {
        return 'http://' + this.host + ':' + this.port + this.path;
    }
}

function AuthenticationInfo(authToken, response) {
    var authHeader = response.headers['www-authenticate'];

    if (authHeader) {
        var authResponse = authHeader.replace(/\"/g, '');
        var values = qs.parse(authResponse,sep=', ',eq='=');

        this.nonce = values['nonce'];
        this.realm = values['Digest realm'];
    }

    this.user = authToken.userName;
    this.digest = authToken.digest;
}

function buildAuthorizationHeader(authInfo, method, path) {
    //TODO update with 'qop' if set
    var HA1 = authInfo.digest;
    var HA2 = md5( method + ":" + path );
    var response = md5(HA1 + ":"+ authInfo.nonce + ":"+ HA2 );

    return 'Digest username="' + authInfo.user + '",' +
        'realm="' + authInfo.realm + '",' +
        'nonce="' + authInfo.nonce + '",' +
        'uri="' + path + '",' +
        'response="' + response + '",' +
        'algorithm="MD5"';
}

function getDavAuth(authToken, response) {
    return new AuthenticationInfo(authToken, response);
}

function getDavAuthorization(authToken, davResponse, method, path) {
    var authInfo = getDavAuth(authToken, davResponse);
    return buildAuthorizationHeader(authInfo, method, path);
}

function readFile(path, onend) {
    fs.readFile(path, "binary", function(error, file) {
        if (onend) {
            onend(error, file);
        }
    });
}

function makePasswordDigest(user, password, realm) {
    return md5(user + ":" + realm + ":" + password);
}

function md5(str) {
    return crypto.createHash('md5').update(str).digest('hex');
}

module.exports.CONTENT_TYPE_XML = "application/xml";
module.exports.CONTENT_TYPE_JSON = "application/json";
module.exports.CONTENT_TYPE_TEXT = "text/plain;charset=utf-8";
module.exports.CONTENT_TYPE_STREAM = "application/octet-stream";

module.exports.HttpRequestParams = HttpRequestParams;
module.exports.AuthenticationInfo = AuthenticationInfo;
module.exports.readFile = readFile;

module.exports.getDavAuthorization = getDavAuthorization;
module.exports.makePasswordDigest = makePasswordDigest;
module.exports.md5 = md5;