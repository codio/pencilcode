var express = require('express'),
    bodyParser = require('body-parser'),
    path = require('path'),
    http = require('http'),
    url = require('url'),
    save = require('./save.js'),
    load = require('./load.js'),
    config = require('./config'),
    utils = require('./utils.js');

var OWNER = 'codio';

exports.initialize = function(app) {
  // Remove the express header.
  app.disable('x-powered-by');

  // Remap any relative directories in the config to base off __dirname
  for (var dir in config.dirs) {
    config.dirs[dir] = path.resolve(__dirname, config.dirs[dir]);
  }
  app.locals.config = config;

  // Set up preprocessor to break url into site and user and filepath.
  if (config.host) {
    app.use(function(req, res, next) {
      res.locals.site = req.headers.host;
      res.locals.owner = OWNER;
      res.locals.portpart = '';
      res.locals.filepath = req.path.replace(/^\/[^\/]*/, '');
      next();
    });
  } else {
    app.use(function(req, res, next) {
      // Take part of domain up to TLD.  This assumes the TLD can be as
      // long as ".kitchen" or ".net.dev" (8 chars) but that the whole domain
      // name is no shorter than "code.org" (8 chars).
      var site = res.locals.site =
          req.hostname.replace(/(?:(.*)\.)?([^.]*.{8})$/, '$2');
      res.locals.owner = req.hostname.substring(0,
          req.hostname.length - site.length - 1);
      res.locals.filepath = req.path.replace(/^\/[^\/]*/, '');
      next();
    });
  }
};

exports.initialize2 = function(app) {
  // Always provide open CORS headers.
  app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('X-XSS-Protection', '0');
    next();
  });

  // Consume urlencoded input.
  app.use(bodyParser.urlencoded({
    extended: false,
    limit: '10mb'
  }));

  // Delegate /load and /save
  app.use('/load', function(req, res) {
    load.handleLoad(req, res, app, 'json');
  });
  app.use('/save', function(req, res) {
    save.handleSave(req, res, app);
  });

  // Rewrite user.pencilcode.net/filename to user.pencilcode.net/user/filename,
  // and then serve the static data.
  var rawUserData = express.static(config.dirs.datadir);
  function staticUserData(req, res, next) {
    var user = res.locals.owner;
    req.url =
      req.url.replace(/^((?:[^\/]*\/\/[^\/]*)?\/)/, "$1" + user + "/");
    rawUserData(req, res, next);
  }
  function userDataPrinter(style) {
    return function (req, res, next) {
      if (!/(?:\.(?:png|gif|jpg|jpeg|ico|bmp|pdf))$/.
          test(req.url)) {
        // Text-like files can be printed nicely.
        load.handleLoad(req, res, app, style);
      }
      else {
        // Non-text files are just treated as static.
        staticUserData(req, res, next);
      }
    }
  }
  function loadThumb() {
    return function(req, res, next) {
      var pathname = url.parse(req.url).pathname;
      if (!/\.png$/.test(pathname)) { next(); return; }
      var thumbPath = utils.makeThumbPath(pathname.replace(/\.png$/, ''));
      req.url = path.join('/', thumbPath);
      rawUserData(req, res, next);
    }
  }
  app.use('/code', userDataPrinter('code'));
  app.use('/home', userDataPrinter('run'));
  app.use('/run', userDataPrinter('run'));
  app.use('/print', userDataPrinter('print'));
  app.use('/thumb', loadThumb());
  app.use('/log', function(req, res) { res.status(204).send(); });

  // Anything not matching a special top-level directory name
  if (config.dirs.staticdir) {
    app.use(express.static(config.dirs.staticdir));
  }

  app.get('*', function(req, res) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 - ' + req.url);
  });

  console.log('Serving', config.dirs.datadir,
    'in', process.env.NODE_ENV, 'mode, on port', process.env.PORT);
};

