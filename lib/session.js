/**
 * @author Catalin Manolescu <cc.manolescu@gmail.com>
 * @since 05 September 2012 - 12:49
 */

var uuid = require('node-uuid');
var Dictionary = require('./Dictionary.js');

var sessionHolder = new Dictionary();
var SESSION_ID_PADDING = "";
var SESSION_COOKIE_ID = "WD_PROXY_SESSION";


var AuthenticationToken = function(userName, email, digest, token) {
    this.userName = userName;
    this.email = email;
    this.digest = digest;
    this.session = token;//uuid.v4();
}

function getCookieID() {
    var id = SESSION_COOKIE_ID;

    if (SESSION_ID_PADDING) {
        id += '_' + SESSION_ID_PADDING;
    }

    return id;
}

function update(authorisation) {
    var token = new AuthenticationToken(authorisation.userName, authorisation.email, authorisation.digest, authorisation.token);
    sessionHolder.store(token.userName, token);
    return token;
}

function lookUpByUserName(userName) {
    return sessionHolder.fetch(userName);
}

function lookUpBySession(session) {
    return sessionHolder.fetchByProperty('session', session);
}

function lookUpByRequest(request) {
    var session = getSessionFromCookie(request);
    return sessionHolder.fetchByProperty('session', session);
}

function getSessionFromCookie(request) {
    var cookies = {};
    request.headers.cookie && request.headers.cookie.split(';').forEach(function( cookie ) {
        var parts = cookie.split('=');
        cookies[ parts[ 0 ].trim() ] = ( parts[ 1 ] || '' ).trim();
    });

    return cookies[getCookieID()];
}
module.exports.sessionPadding = function(value) {
    SESSION_ID_PADDING = value;
}
module.exports.cookieID = getCookieID;
module.exports.update = update;
module.exports.lookUpBySession = lookUpBySession;
module.exports.lookUpByRequest = lookUpByRequest;
module.exports.lookUpByUserName = lookUpByUserName;
