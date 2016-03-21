'use strict';

/************
 * includes *
 ************/
const fs = require('fs');
const dns = require('dns');
const http = require('http');

const proxy = require('http-proxy');
const xmldom = require('xmldom');

/********
 * main *
 ********/
function SlsProxy(opts) {
  if (!(this instanceof SlsProxy)) return new SlsProxy(opts);

  if (typeof opts === 'undefined') opts = {};
  this.host = (typeof opts.host !== 'undefined') ? opts.host : 'sls.service.enmasse.com';
  this.port = (typeof opts.port !== 'undefined') ? opts.port : 8080;
  this.customServers = (typeof opts.customServers !== 'undefined') ? opts.customServers : {};

  this.address = null;
  this.proxy = null;
  this.server = null;
}

SlsProxy.prototype.setServers = function setServers(servers) {
  // TODO is this a necessary method?
  this.customServers = servers;
};

SlsProxy.prototype._resolve = function _resolve(callback) {
  if (this.address === null) {
    dns.resolve(this.host, (err, addresses) => {
      if (!err) {
        this.address = addresses[0];
      }
      callback(err);
    });
  } else {
    process.nextTick(callback);
  }
};

SlsProxy.prototype.fetch = function fetch(callback) {
  const self = this;
  self._resolve(function _fetch(err) {
    const req = http.request({
      hostname: (self.address === null) ? self.host : self.address,
      port: self.port,
      path: '/servers/list.en',
    });

    req.on('response', function onResponse(res) {
      var data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', function onEnd() {
        const servers = {};
        const doc = new xmldom.DOMParser().parseFromString(data, 'text/xml');
        for (let server of Array.from(doc.getElementsByTagName('server'))) {
          const serverInfo = {};
          for (let node of Array.from(server.childNodes)) {
            if (node.nodeType !== 1) continue;
            switch (node.nodeName) {
              case 'id':
              case 'ip':
              case 'port':
                serverInfo[node.nodeName] = node.textContent;
                break;
              case 'name':
                for (let c of Array.from(node.childNodes)) {
                  if (c.nodeType === 4) { // CDATA_SECTION_NODE
                    serverInfo.name = c.data;
                    break;
                  }
                }
                break;
            }
          }
          if (serverInfo.id) {
            servers[serverInfo.id] = serverInfo;
          }
        }

        callback(null, servers);
      });
    });

    req.on('error', (e) => callback(e));

    req.end();
  });
};

SlsProxy.prototype.listen = function listen(hostname, callback) {
  const self = this;
  self._resolve(function _listen(err) {
    if (err) return callback(err);

    const proxied = self.proxy = proxy.createProxyServer({
      target: 'http://' + self.address + ':' + self.port
    });

    proxied.on('proxyReq', function onProxyReq(proxyReq, req, res, options) {
      proxyReq.setHeader('Host', self.host + ':' + self.port);
    });

    const server = self.server = http.createServer(function onRequest(req, res) {
      if (req.url[0] != '/') return res.end();

      if (req.url === '/servers/list.en') {
        const writeHead = res.writeHead;
        const write = res.write;
        const end = res.end;
        var data = '';

        res.writeHead = function _writeHead(code, headers) {
          res.removeHeader('Content-Length');
          if (headers) delete headers['content-length'];
          writeHead.apply(res, arguments);
        };

        res.write = function _write(chunk) {
          data += chunk;
        };

        res.end = function _end(chunk) {
          if (chunk) data += chunk;

          const doc = new xmldom.DOMParser().parseFromString(data, 'text/xml');
          const servers = Array.from(doc.getElementsByTagName('server'));
          for (let server of servers) {
            for (let node of Array.from(server.childNodes)) {
              if (node.nodeType === 1 && node.nodeName === 'id') {
                const settings = self.customServers[node.textContent];
                if (settings) {
                  if (!settings.overwrite) {
                    let parent = server.parentNode;
                    server = server.cloneNode(true);
                    parent.appendChild(server);
                  }
                  for (let n of Array.from(server.childNodes)) {
                    if (n.nodeType !== 1) continue; // ensure type: element
                    switch (n.nodeName) {
                      case 'ip':
                        n.textContent = (typeof settings.ip !== 'undefined') ? settings.ip : '127.0.0.1';
                        break;

                      case 'port':
                        if (typeof settings.port !== 'undefined') {
                          n.textContent = settings.port;
                        }
                        break;

                      case 'name':
                        if (typeof settings.name !== 'undefined') {
                          for (let c of Array.from(n.childNodes)) {
                            if (c.nodeType === 4) { // CDATA_SECTION_NODE
                              c.data = settings.name;
                              break;
                            }
                          }
                          for (let a of Array.from(n.attributes)) {
                            if (a.name === 'raw_name') {
                              a.value = settings.name;
                              break;
                            }
                          }
                        }
                        break;

                      case 'crowdness':
                        if (!settings.overwrite) {
                          //n.textContent = 'None';
                          for (let a of Array.from(n.attributes)) {
                            if (a.name === 'sort') {
                              // 0 crowdness makes this server highest priority
                              // if there are multiple servers with this ID
                              a.value = '0';
                              break;
                            }
                          }
                        }
                        break;
                    }
                  }
                }
              }
            }
          }

          data = new xmldom.XMLSerializer().serializeToString(doc);
          write.call(res, data, 'utf8');
          end.call(res);
        };
      }

      proxied.web(req, res, function (err) {
        console.warn('* error proxying request');
        console.warn(err);
        console.warn();
        res.end();
      });
    });

    server.listen(self.port, '127.0.0.1', callback);
  });
};

SlsProxy.prototype.close = function close() {
  if (this.server !== null) this.server.close();
};

/***********
 * exports *
 ***********/
module.exports = SlsProxy;
