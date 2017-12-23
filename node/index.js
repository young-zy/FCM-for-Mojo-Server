var http = require('http');
var https = require('https');
var httpProxy = require('http-proxy');
var auth = require('http-auth');
var fs = require('fs');
var config = require('../config');

var push = require('./push');

var version = require('../package.json').version;

var FFMConfig = require('./ffm-config');
var ffmConfig = new FFMConfig(config.client_config);

push.ids = ffmConfig.ids;

var MojoQQ = require('./mojo-webqq');
var mojoQQ = new MojoQQ(config.local_port, config.mojo.webqq.openqq);

var debug = config.debug || false;

console.dir(ffmConfig.ids);

function exitHandler () {
    // TODO push to client server exited
    console.log("[FFM] exit");
    mojoQQ.kill('SIGTERM');
}
process.on('exit', exitHandler);
process.on('SIGINT', exitHandler);

var proxy = httpProxy.createProxyServer({
    proxyTimeout: 3000
});

proxy.on('error', function(err, req, res) {
    if (err.code === "ECONNREFUSED") {
        res.writeHead(502, {
            'Content-Type': 'text/plain'
        });
        res.end('webqq dead');
    } else {
        res.writeHead(502, {
            'Content-Type': 'text/plain'
        });
        res.end('webqq error');
    }
});

function handle(req, res) {
    var data = ffmConfig.data;
    switch (req.url) {
        case '/ffm/send':
        case '/ffm/update_registration_ids':
        case '/ffm/update_notifications_toggle':
        case '/ffm/update_group_whitelist':
        case '/ffm/update_discuss_whitelist':
            handlePost(req, res);
            break;

        case '/ffm/get_status':
            res.writeHead(200, {"Content-Type": "application/json"});
            res.end(JSON.stringify({
                devices: data.registration_ids.length,
                group_whitelist: {
                    enabled: data.group_whitelist.enabled,
                    count: data.group_whitelist.list.length
                },
                discuss_whitelist: {
                    enabled: data.discuss_whitelist.enabled,
                    count: data.discuss_whitelist.list.length
                },
                version: version,
                running: mojoQQ.running()
            }));
            break;
        case '/ffm/get_registration_ids':
            res.writeHead(200, {"Content-Type": "application/json"});
            res.end(JSON.stringify(data.registration_ids));
            break;
        case '/ffm/get_notifications_toggle':
            res.writeHead(200, {"Content-Type": "application/json"});
            res.end(JSON.stringify(data.notifications));
            break;
        case '/ffm/get_group_whitelist':
            res.writeHead(200, {"Content-Type": "application/json"});
            res.end(JSON.stringify(data.group_whitelist));
            break;
        case '/ffm/get_discuss_whitelist':
            res.writeHead(200, {"Content-Type": "application/json"});
            res.end(JSON.stringify(data.discuss_whitelist));
            break;
        case '/ffm/restart':
            res.writeHead(200, {"Content-Type": "application/json"});
            res.end(JSON.stringify({
                code: mojoQQ.restart() ? 1 : 0
            }));
            break;
        case '/ffm/stop':
            res.writeHead(200, {"Content-Type": "application/json"});
            res.end(JSON.stringify({
                code: mojoQQ.kill('SIGTERM') ? 1 :0
            }));
            break;
        case '/ffm/get_qr_code':
            fs.readFile('/var/www/html/mojo_webqq_qrcode_ffm.png', (err, buf) => {
                if (err) {
                    console.error("/var/www/html/mojo_webqq_qrcode_ffm.png: no such file");
                    res.writeHead(404);
                    res.end();
                    return;
                }
                res.writeHead(200, {"Content-Type": "image/png"});
                res.end(buf, 'binary');
            });
            break;
        default:
            if (req.url.indexOf('/openqq') === 0) {
                proxy.web(req, res, {
                    target: 'http://localhost:' + config.mojo.webqq.openqq + '/'
                });
            } else {
                res.writeHead(403, {
                    'Content-Type': 'text/plain'
                });
                res.end();
            }
    }
}

function handlePost(req, res) {
    if (req.method === 'POST') {
        var body = '';
    } else {
        res.writeHead(403, {
            'Content-Type': 'text/plain'
        });
        res.end();
        return;
    }

    req.on('data', function (data) {
        body += data;
    });

    req.on('end', function () {
        if (req.headers['content-type'] === "application/json") {
            body = JSON.parse(body);
        }

        onPostEnd(req, res, body);
    });
}

function onPostEnd(req, res, body) {
    switch (req.url) {
        case '/ffm/send':
            onSendMessage(body);
            break;
        case '/ffm/update_registration_ids':
            ffmConfig.data.registration_ids = body;
            ffmConfig.save();

            push.ids = ffmConfig.ids;
            break;
        case '/ffm/update_notifications_toggle':
            ffmConfig.data.notifications = body;
            ffmConfig.save();

            if (debug) {
                console.log('[FFM] new notification toggle ' + JSON.stringify(body));
            }
            break;
        case '/ffm/update_group_whitelist':
            ffmConfig.data.group_whitelist = body;
            ffmConfig.save();

            if (debug) {
                console.log('[FFM] new group whitelist ' + JSON.stringify(body));
            }
            break;
        case '/ffm/update_discuss_whitelist':
            ffmConfig.data.discuss_whitelist = body;
            ffmConfig.save();

            if (debug) {
                console.log('[FFM] new discuss whitelist ' + JSON.stringify(body));
            }
            break;
        default:
            res.writeHead(403, {
                'Content-Type': 'text/plain'
            });
            return;
    }

    res.writeHead(200, {"Content-Type": "application/json"});
    res.end(JSON.stringify({
        code: 0
    }));
}

function onSendMessage(body) {
    var type = body.type;
    var isAt = false;
    if (type === 1 || type === 2) {
        isAt = body.message.isAt === 1;
    }

    // 好友及群组开关
    var friend = ffmConfig.data.notifications.friend;
    var group = ffmConfig.data.notifications.group;

    if ((type === 1 || type === 2) && (group === false && (!isAt || friend === false))) {
        if (debug) {
            console.log('[FFM] do not send "' + body.message.content + '", because group toggle.')
        }

        return;
    }

    if (type === 0 && friend === false) {
        if (debug) {
            console.log('[FFM] do not send "' + body.message.content + '", because friend toggle.')
        }

        return;
    }

    var group_whitelist = ffmConfig.data.group_whitelist;
    if (type === 1 && !isAt && group_whitelist.enabled && group_whitelist.list.indexOf(body.uid) === -1) {
        if (debug) {
            console.log('[FFM] do not send "' + body.message.content + '", because group is not in whitelist.')
        }

        return;
    }

    var discuss_whitelist = ffmConfig.data.discuss_whitelist;
    if (type === 2 && !isAt && discuss_whitelist.enabled && discuss_whitelist.list.indexOf(body.name) === -1) {
        if (debug) {
            console.log('[FFM] do not send "' + body.message.content + '", because discuss is not in whitelist.')
        }

        return;
    }

    push.send(body);
}

var requestListener = function(req, res) {
    console.log("[FFM] " + req.url);

    handle(req, res);
};

var httpsOptions;
if (config.https !== undefined) {
    httpsOptions = config.https;
    console.log('[FFM] https configuration found');
} else {
    console.log('[FFM] no https configuration found');
}

var server;
if (config.basic_auth === undefined) {
    console.log('[FFM] no basic auth configuration found');
    if (httpsOptions !== undefined) {
        server = https.createServer(httpsOptions, requestListener);
    } else {
        server = http.createServer(requestListener);
    }
} else {
    console.log('[FFM] using basic auth, passwd file: ' + config.basic_auth.file);
    var basic = auth.basic(config.basic_auth);
    if (httpsOptions !== undefined) {
        server = https.createServer(basic, httpsOptions, requestListener);
    } else {
        server = http.createServer(basic, requestListener);
    }
}

if (config.hostname === undefined) {
    server.listen(config.port);
    console.log('[FFM] listening ' + config.port);
} else {
    server.listen(config.port, config.hostname);
    console.log('[FFM] listening ' + config.port + ", " + config.hostname);
}

http.createServer(requestListener).listen(config.local_port, '127.0.0.1');
//console.log('[FFM] listening ' + config.local_port);
