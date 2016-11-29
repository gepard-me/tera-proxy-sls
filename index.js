const fs = require('fs');
const dns = require('dns');
const http = require('http');

const proxy = require('http-proxy');
const xmldom = require('xmldom');

function asArray(nodes) {
  return Array.from(nodes || []);
}

class SlsProxy {
  constructor(opts = {}) {
    if (!(this instanceof SlsProxy)) return new SlsProxy(opts);

    this.host = opts.host || 'sls.service.enmasse.com';
    this.port = (opts.port != null) ? opts.port : 8080;
    this.customServers = opts.customServers || {};
    this.listenHostname = opts.listenHostname || '127.0.0.1';

    this.address = null;
    this.proxy = null;
    this.server = null;
  }

  setServers(servers) {
    // TODO is this a necessary method?
    this.customServers = servers;
  }

  _resolve(callback) {
    if (this.address === null) {
      dns.resolve(this.host, (err, addresses) => {
        if (!err) this.address = addresses[0];
        callback(err);
      });
    } else {
      process.nextTick(callback);
    }
  }

  fetch(callback) {
    this._resolve((err) => {
      const req = http.request({
        hostname: this.address || this.host,
        port: this.port,
        path: '/servers/list.en',
      });

      req.on('response', (res) => {
        let data = '';

        res.on('error', (e) => {
          console.warn();
          console.warn('[sls] error fetching server list');
          console.warn(e);
          console.warn();
          // TODO what kind of errors will be here? how should we handle them?
        });

        res.on('data', chunk => data += chunk);

        res.on('end', () => {
          const doc = new xmldom.DOMParser().parseFromString(data, 'text/xml');
          if (!doc) {
            callback(new Error('failed to parse document'));
            return;
          }

          const servers = {};
          for (let server of asArray(doc.getElementsByTagName('server'))) {
            const serverInfo = {};

            for (let node of asArray(server.childNodes)) {
              if (node.nodeType !== 1) continue;
              switch (node.nodeName) {
                case 'id':
                case 'ip':
                case 'port': {
                  serverInfo[node.nodeName] = node.textContent;
                  break;
                }

                case 'name': {
                  for (let c of asArray(node.childNodes)) {
                    if (c.nodeType === 4) { // CDATA_SECTION_NODE
                      serverInfo.name = c.data;
                      break;
                    }
                  }
                  break;
                }
              }
            }

            if (serverInfo.id) {
              servers[serverInfo.id] = serverInfo;
            }
          }

          callback(null, servers);
        });
      });

      req.on('error', (e) => {
        callback(e);
      });

      req.end();
    });
  }

  listen(hostname, callback) {
    this._resolve((err) => {
      if (err) return callback(err);

      const proxied = proxy.createProxyServer({
        target: `http://${this.address}:${this.port}`,
      });

      proxied.on('proxyReq', (proxyReq, req, res, options) => {
        proxyReq.setHeader('Host', this.host + ':' + this.port);
      });

      const server = http.createServer((req, res) => {
        if (req.url[0] != '/') return res.end();

        if (req.url === '/servers/list.en') {
          const writeHead = res.writeHead;
          const write = res.write;
          const end = res.end;

          const self = this;
          let data = '';

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
            if (!doc) {
              // assume xmldom already logged an error
              write.call(res, data, 'utf8');
              end.call(res);
              return;
            }

            const servers = asArray(doc.getElementsByTagName('server'));
            for (let server of servers) {
              for (let node of asArray(server.childNodes)) {
                if (node.nodeType === 1 && node.nodeName === 'id') {
                  const settings = self.customServers[node.textContent];
                  if (settings) {
                    if (!settings.overwrite) {
                      const parent = server.parentNode;
                      server = server.cloneNode(true);
                      parent.appendChild(server);
                    }
                    for (let n of asArray(server.childNodes)) {
                      if (n.nodeType !== 1) continue; // ensure type: element
                      switch (n.nodeName) {
                        case 'ip': {
                          n.textContent = (typeof settings.ip !== 'undefined') ? settings.ip : '127.0.0.1';
                          break;
                        }

                        case 'port': {
                          if (typeof settings.port !== 'undefined') {
                            n.textContent = settings.port;
                          }
                          break;
                        }

                        case 'name': {
                          if (typeof settings.name !== 'undefined') {
                            for (let c of asArray(n.childNodes)) {
                              if (c.nodeType === 4) { // CDATA_SECTION_NODE
                                c.data = settings.name;
                                break;
                              }
                            }
                            for (let a of asArray(n.attributes)) {
                              if (a.name === 'raw_name') {
                                a.value = settings.name;
                                break;
                              }
                            }
                          }
                          break;
                        }

                        case 'crowdness': {
                          if (!settings.overwrite) {
                            //n.textContent = 'None';
                            for (let a of asArray(n.attributes)) {
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
            }

            data = new xmldom.XMLSerializer().serializeToString(doc);
            write.call(res, data, 'utf8');
            end.call(res);
          };
        }

        proxied.web(req, res, (err) => {
          console.warn();
          console.warn('[sls] error proxying request to ' + req.url);
          console.warn(err);
          console.warn();

          res.writeHead(500, err.toString(), { 'Content-Type': 'text/plain' });
          res.end();
        });
      });

      this.proxy = proxied;
      this.server = server;

      server.listen(this.port, this.listenHostname, callback);
    });
  }

  close() {
    if (this.server !== null) this.server.close();
  }
}

module.exports = SlsProxy;
