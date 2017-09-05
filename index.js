const wildcard = require('wildcard');
const co = require('co');
const IPCheck = require('ipcheck');
const net = require('net');


const PopulationStrategies = {
    'express': {
        getMethod: (req, res) => {
            return req.method;
        },
        getPath: (req, res) => {
            return req.path;
        },
        isSecure: (req, res) => {
            return req.secure;
        },
        getOrigin: (req, res) => {
            return req.get('origin') || '';
        },
        getIpAddress: (req, res) => {
            return req.ip;
        }
    },
    'restify': {
        getMethod: (req, res) => {
            return req.method;
        },
        getPath: (req, res) => {
            return req.getPath();
        },
        isSecure: (req, res) => {
            return req.isSecure();
        },
        getOrigin: (req, res) => {
            return req.headers['origin'] || '';
        },
        getIpAddress: (req, res) => {
        var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        if (ip === '::1') {
            return '127.0.0.1';
        }
        if (net.isIP(ip) === 6) {
            return ip.substring(7);
        }
        return ip;        }
    }
}

function checkIp(ipToCheck, ipAddresses) {
    var ip = new IPCheck(ipToCheck);
    for (var i = 0; i <= ipAddresses.length; i++) {
        var whiteListIp = new IPCheck(ipAddresses[i]);
        if (ip.match(whiteListIp)) {
            return true;
        }
    }
    return false;
}

function compare(pattern, s) {
    if (typeof (s) !== 'string') return false;

    if (pattern instanceof RegExp) {
        return s.match(pattern);
    }

    return wildcard(pattern, s);
}

function roleschk(uroles, rroles) {
    if (uroles.length === 0) return rroles.indexOf('*') >= 0;

    for (let i = 0; i < rroles.length; i++) {
        for (let z = 0; z < uroles.length; z++) {
            if (compare(rroles[i], uroles[z])) return true;
        }
    }

    return false;
}

function emptyfn() {
    return Promise.resolve(true);
}

module.exports = (config) => {
    config.defaultAction = (config.defaultAction || 'DROP').toUpperCase();
    for (let rule of config.rules) {
        rule.origin = rule.origin || ['*'];
        rule.methods = rule.methods || ['*'];
        rule.ipAddresses = rule.ipAddresses || ['*'];
        rule.secure = (rule.secure === true);
        rule.handler = rule.handler || emptyfn;
    }
    let strategy = PopulationStrategies[config.populationStrategy] || PopulationStrategies['restify'];

    return function (req, res, next) {
        co(function* () {
            let getUserEmail = config.getUserEmail || ((req) => Promise.resolve(req.user ? req.user.email : null));
            let getUserPhone = config.getUserPhone || ((req) => Promise.resolve(req.user ? req.user.phone : null));
            let getUserRoles = config.getUserRoles || ((req) => Promise.resolve(req.user ? req.user.roles : null));

            let method = strategy.getMethod(req, res);
            let path = strategy.getPath(req, res);
            let secure = strategy.isSecure(req, res);
            let origin = strategy.getOrigin(req, res);
            let ipAddress = strategy.getIpAddress(req, res);
            let email = yield getUserEmail(req);
            let phone = yield getUserPhone(req);
            let roles = yield getUserRoles(req);

            for (let rule of config.rules) {
                if (rule.paths.find((e) => compare(e, path))) {
                    if (rule.methods.find((e) => compare(e.toUpperCase(), method)) &&
                        rule.origin.find((e) => compare(e, origin)) &&
                        // rule.ipAddresses.find((e) => compare(e, ipAddress)) &&
                        checkIp(ipAddress,rule.ipAddresses) &&
                        (!rule.users || rule.users.find((e) => compare(e, email)) || rule.users.find((e) => compare(e, phone))) &&
                        (!rule.roles || roleschk(roles, rule.roles)) &&
                        (undefined === rule.secure || secure == rule.secure) &&
                        (yield rule.handler(req))) {
                        switch (rule.action.toUpperCase()) {
                            case 'ACCEPT':
                                next();
                                break;
                            case 'DROP':
                                // let err = new Error();
                                // err.statusCode = 410;
                                res.send(410);
                                next(false);

                                break;
                        }

                        return;
                    }
                }
            }

            switch (config.defaultAction) {
                case 'ACCEPT':
                    next();
                    break;
                case 'DROP':
                    // let err = new Error();
                    // err.statusCode = 410;
                    res.send(410);
                    next(false);
                    break;
            }
        }).catch(next);
    };
}