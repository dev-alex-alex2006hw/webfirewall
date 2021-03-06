const wildcard = require('wildcard');
const co = require('co');
// const IPCheck = require('ipcheck');
const CIDRMatcher = require('cidr-matcher');
const net = require('net');
let config = null;

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
            var ip = '';
            if (config.checkXForwardedForIndex != null){
                if ( req.headers['x-forwarded-for'] != null){
                    var ary =  req.headers['x-forwarded-for'].split(',');
                    if (ary && ary.length && ary.length > config.checkXForwardedForIndex ){
                        if (config.checkXForwardedForIndex < 0 ){
                            ip = ary[ary.length + config.checkXForwardedForIndex];
                        }else{
                            ip = ary[config.checkXForwardedForIndex];
                        }
                    }
                }
            }else{
                ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
            }
       
            if (ip === '::1') {
                return '127.0.0.1';
            }
            if (net.isIP(ip) === 6) {
                return ip.substring(7);
            }
            return ip;        
        }
    }
}

function checkIp(ipToCheck, ipAddresses) {
    
    // console.log('Searching ' + ipToCheck + ' in ' + ipAddresses);
    var matcher = new CIDRMatcher(ipAddresses);
    
    for(var j=0; j < ipToCheck.split(",").length; j++){
        // console.log('Validating: ' + ipToCheck.split(",")[j].trim());
        if(matcher.contains(ipToCheck.split(",")[j].trim())){
            // console.log('I got a match');
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

module.exports = (cfg) => {
    config = cfg;
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
            //let getUserEmail = config.getUserEmail || ((req) => Promise.resolve(req.user ? req.user.email : null));
            //let getUserPhone = config.getUserPhone || ((req) => Promise.resolve(req.user ? req.user.phone : null));
            //let getUserRoles = config.getUserRoles || ((req) => Promise.resolve(req.user ? req.user.roles : null));

            let method = strategy.getMethod(req, res);
            let path = strategy.getPath(req, res);
            let secure = strategy.isSecure(req, res);
            let origin = strategy.getOrigin(req, res);
            let ipAddress = strategy.getIpAddress(req, res);
            //let email = yield getUserEmail(req);
            //let phone = yield getUserPhone(req);
            //let roles = yield getUserRoles(req);

            for (let rule of config.rules) {
                if (rule.paths.find((e) => compare(e, path))) {
                    if (rule.methods.find((e) => compare(e.toUpperCase(), method)) &&
                        rule.origin.find((e) => compare(e, origin)) &&
                        checkIp(ipAddress,rule.ipAddresses)){
                        switch (rule.action.toUpperCase()) {
                            case 'ACCEPT':
                                //console.log('accepted');
                                next();
                                break;
                            case 'DROP':
                                //console.log('dropped');
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
                    // console.log('ACCEPTED');

                    break;
                case 'DROP':
                    // console.log('DROPPED');

                    res.send(410);
                    next(false);
                    break;
            }
        }).catch(next);
    };
}
