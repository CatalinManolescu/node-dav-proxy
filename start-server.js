/**
 * @author Catalin Manolescu <cc.manolescu@gmail.com>
 * @since 05 September 2012 - 10:12
 */

var proxy       = require('./lib/server.js');
proxy.init(process.argv[2], process.argv[3], process.argv[4], process.argv[5], process.argv[6], afterRequestHandler);

proxy.enableDevelopmentMode(true);
proxy.createSession('demo', 'demo', 'WebDAV');

function afterRequestHandler( command ) {
    console.log(command);
}