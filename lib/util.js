/**
 * @author Catalin Manolescu <cc.manolescu@gmail.com>
 * @since 05 September 2012 - 12:34
 */

var fs = require('fs');
var crypto = require('crypto');
var qs = require('querystring');
var xml2js = require('xml2js');

function WDCommand() {
    this.name = '';
    this.path = '';
    this.params = {};

    this.setParam = function(key, value) {
        if ( !this.params ) {
            this.params = {};
        }

        this.params[key] = value;
    }

    this.toString = function() {
        return JSON.stringify(this);
    }
}

function HttpRequestParams() {
    this.protocol = 'http:';
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
        this.path += value;
    }

    this.fullPath = function () {
        return this.protocol + '//' + this.host + ':' + this.port + this.path;
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
    fs.readFile(path, function(error, file) {
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

function parsePropFindResponse(basePath, response, callback) {
    //parse result xml
    var parser = new xml2js.Parser();
    parser.parseString(response, function(error, data) {
        var resources = new Array();

        var resourceIndex = basePath.length;
        var responseList = data['D:multistatus']['D:response'];

        for (var key in responseList) {
            var response = responseList[key];
            var resourceProperties = response['D:propstat'][0]['D:prop'][0];
            console.log(resourceProperties);
            var resource = {};
            var resourceName = decodeURI(response['D:href'].toString().substring(resourceIndex));
            if (resourceName.length == 0 || resourceName === '/') {
                resourceName = '.';
            }
            resource.path = resourceName;
            resource.creationDate = resourceProperties['lp1:creationdate'][0];
            resource.lastModified = resourceProperties['lp1:getlastmodified'][0];
            resource.type = resourceProperties['D:getcontenttype'] ? resourceProperties['D:getcontenttype'][0] : undefined;

            resources.push(resource);
        }

        callback(resources);
    });
}

module.exports.CONTENT_TYPE_XML = "application/xml";
module.exports.CONTENT_TYPE_JSON = "application/json";
module.exports.CONTENT_TYPE_TEXT = "text/plain;charset=utf-8";
module.exports.CONTENT_TYPE_STREAM = "application/octet-stream";

module.exports.WebDavCommand = WDCommand;
module.exports.HttpRequestParams = HttpRequestParams;
module.exports.AuthenticationInfo = AuthenticationInfo;
module.exports.readFile = readFile;
module.exports.parsePropFindResponse = parsePropFindResponse;

module.exports.getDavAuthorization = getDavAuthorization;
module.exports.makePasswordDigest = makePasswordDigest;
module.exports.md5 = md5;