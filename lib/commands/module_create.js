'use strict';

/**
 * JAWS Command: New Module (Lambda/Endpoint)
 */

// Defaults
var JawsError = require('../jaws-error'),
    JawsCLI = require('../utils/cli'),
    Promise = require('bluebird'),
    fs = require('fs'),
    path = require('path'),
    utils = require('../utils');

var supportedRuntimes = {
  nodejs: {
    defaultPkgMgr: 'npm',
    validPkgMgrs: ['npm'],
  },
};
var supportedMethods = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'];

Promise.promisifyAll(fs);

/**
 *
 * @param JAWS
 * @param name
 * @param action
 * @param options
 * @returns {*}
 */
module.exports.run = function(JAWS, name, action, options) {
  var command = new CMD(JAWS, name, action, options);
  return command.run();
};

/**
 *
 * @param JAWS
 * @param name
 * @param action
 * @param options
 * @constructor
 */
function CMD(JAWS, name, action, options) {

  // Enforce defaults
  var runtime = options.runtime || 'nodejs'
    , pkgMgr = options.packageManager || false
    , modType = options.moduleType || 'both'
    , method = options.method || 'GET'
    , path = options.path || name + '/' + action
    , queryParams = options.queryParams || []
    , requestParameters = {}
    , requestTemplates = "";

  if (!supportedRuntimes[runtime]) {
    throw new JawsError('Unsupported runtime "' + runtime + '"', JawsError.errorCodes.UNKNOWN);
  }

  method = method.toUpperCase();
  if (supportedMethods.indexOf(method) === -1) {
    throw new JawsError('Unsupported method "' + method + '". Must be one of ' + supportedMethods.join(', ') +
                        '.', JawsError.errorCodes.UNKNOWN);
  }

  // Path variables in the awsm.json shouldn't have a leading slash. Remove it if it was given.
  if (path.indexOf('/') === 0) {
    path = path.substring(1);
  }
  var pathParams = _extractPathParams(path);

  if (["POST", "PUT", "PATCH"].indexOf(method) > -1) {
    // If the method supports a body, remap that to the body attribute of the request template.
    requestTemplates += '\"body\": $input.json(\'$\')';
  }
  _appendRequestParameters(requestParameters, pathParams, 'path')
  _appendRequestParameters(requestParameters, queryParams, 'querystring')
  requestTemplates = _appendRequestTemplateVars(requestTemplates, pathParams);
  requestTemplates = _appendRequestTemplateVars(requestTemplates, queryParams);
  requestTemplates = { 'application/json': '{' + requestTemplates + '}' };

  var _this = this,
      supportedRuntimeObj = supportedRuntimes[runtime];

  this._JAWS = JAWS;
  this._module = {
    name: name,
    action: action,
    runtime: runtime,
    pkgMgr: pkgMgr,
    modType: modType,
    method: method,
    path: path,
    requestParameters: requestParameters,
    requestTemplates: requestTemplates,
  };
  this._prompts = {
    properties: {},
  };
  this.Prompter = JawsCLI.prompt();
  this.Prompter.override = {};

  if (pkgMgr && supportedRuntimeObj.validPkgMgrs.indexOf(_this._module.pkgMgr) == -1) {
    throw new JawsError('Unsupported package manger "' + _this._module.pkgMgr + '"', JawsError.errorCodes.UNKNOWN);
  }
}

CMD.prototype.constructor = CMD;

/**
 * CMD: Run
 */

CMD.prototype.run = Promise.method(function() {
  var _this = this;

  return _this._JAWS.validateProject()
      .bind(_this)
      .then(_this._sanitizeData)
      .then(_this._createSkeleton)
      .then(_this._createPackageMgrSkeleton)
      .then(function() {
        JawsCLI.log('Successfully created '
            + _this._module.name
            + '/'
            + _this._module.action);
      });
});

/**
 * Install package manager skeleton
 *
 * @returns {Promise}
 */

CMD.prototype._createPackageMgrSkeleton = function() {
  var _this = this,
      deferredWrites = [];

  switch (_this._module.runtime) {
    case 'nodejs':
      if (_this._module.pkgMgr == 'npm') {

        var modulePath = path.join(
            _this._JAWS._meta.projectRootPath,
            'node_modules',
            _this._module.name);
        var templatesPath = path.join(__dirname, '..', 'templates');

        // Create node_module if DNE in node_modules
        if (!utils.dirExistsSync(modulePath)) {
          deferredWrites.push(fs.mkdirAsync(modulePath));
        }

        // Create module package.json if DNE in node_module
        if (!utils.fileExistsSync(path.join(modulePath, 'package.json'))) {
          var packageJsonTemplate = utils.readAndParseJsonSync(path.join(templatesPath, 'nodejs', 'package.json'));
          packageJsonTemplate.name = _this._name;
          packageJsonTemplate.description = 'An aws-module';
          packageJsonTemplate.dependencies = {};
          if (packageJsonTemplate.private) delete packageJsonTemplate.private;
          deferredWrites.push(
              fs.writeFileAsync(
                  path.join(modulePath, 'package.json'),
                  JSON.stringify(packageJsonTemplate, null, 2)
              )
          );
        }

        // Create module awsm.json if DNE in node_module
        if (!utils.fileExistsSync(path.join(modulePath, 'awsm.json'))) {
          var moduleTemplateJson = utils.readAndParseJsonSync(path.join(templatesPath, 'module.awsm.json'));
          moduleTemplateJson.name = _this._module.name;
          deferredWrites.push(
              utils.writeFile(
                  path.join(modulePath, 'awsm.json'),
                  JSON.stringify(moduleTemplateJson, null, 2)));
        }

        // Create root lib folder if DNE in node_module
        var modLibPath = path.join(modulePath, 'lib');
        if (!utils.dirExistsSync(modLibPath)) {
          deferredWrites.push(fs.mkdirAsync(modLibPath));
        }

        // Create awsm folder if DNE in node_module
        if (!utils.dirExistsSync(path.join(modulePath, 'awsm'))) {
          deferredWrites.push(fs.mkdirAsync(path.join(modulePath, 'awsm')));
        }

        // Create action if DNE in node_module
        var actionPath = path.join(modulePath, 'awsm', _this._module.action);
        if (!utils.dirExistsSync(actionPath)) {

          // Fetch skeleton resources
          var actionTemplateJson = utils.readAndParseJsonSync(
              path.join(templatesPath,
                  'action.awsm.json'));

          // Create action awsm.json
          actionTemplateJson.apiGateway.cloudFormation.Path = _this._module.path;
          actionTemplateJson.apiGateway.cloudFormation.Method = _this._module.method;
          actionTemplateJson.apiGateway.cloudFormation.Type = 'AWS';
          actionTemplateJson.apiGateway.cloudFormation.RequestParameters = _this._module.requestParameters;
          actionTemplateJson.apiGateway.cloudFormation.RequestTemplates = _this._module.requestTemplates;
          actionTemplateJson.lambda.cloudFormation.Runtime = 'nodejs';
          actionTemplateJson.lambda.cloudFormation.Handler = path.join(
              'aws_modules',
              _this._module.name,
              _this._module.action,
              'handler.handler');

          // Create handler.js, index.js, event.json, package.json
          var handlerJs = fs.readFileSync(path.join(templatesPath, 'nodejs', 'handler.js'));
          var indexJs = fs.readFileSync(path.join(templatesPath, 'nodejs', 'index.js'));

          deferredWrites.push(
              utils.writeFile(
                  path.join(actionPath, 'awsm.json'),
                  JSON.stringify(actionTemplateJson, null, 2)
              ),
              utils.writeFile(path.join(actionPath, 'handler.js'), handlerJs),
              utils.writeFile(path.join(actionPath, 'index.js'), indexJs),
              utils.writeFile(path.join(actionPath, 'event.json'), '{}')
          );
        }
      }

      break;
    default:
      break;
  }

  return Promise.all(deferredWrites);
};

/**
 * CMD: Sanitize Data
 */

CMD.prototype._sanitizeData = Promise.method(function() {

  var _this = this;

  _this._module.name = _this._module.name.toLowerCase().trim()
      .replace(/\s/g, '-')
      .replace(/[^a-zA-Z-\d:]/g, '')
      .substring(0, 19);

  _this._module.action = _this._module.action.toLowerCase().trim()
      .replace(/\s/g, '-')
      .replace(/[^a-zA-Z-\d:]/g, '')
      .substring(0, 19);

});

/**
 * CMD: Create skeleton
 */

CMD.prototype._createSkeleton = Promise.method(function() {

  var _this = this;
  var writeFilesDeferred = [];

  // Fetch skeleton resources
  var templatesPath = path.join(__dirname, '..', 'templates');
  var actionTemplateJson = utils.readAndParseJsonSync(path.join(templatesPath, 'action.awsm.json'));
  var modulePath = path.join(
      _this._JAWS._meta.projectRootPath,
      'aws_modules',
      _this._module.name);
  var actionPath = path.join(modulePath, _this._module.action);

  // If module/action already exists, throw error
  if (utils.dirExistsSync(actionPath)) {
    throw new JawsError(
        actionPath + ' already exists',
        JawsError.errorCodes.INVALID_PROJECT_JAWS
    );
  }

  //module path will get created by util.writeFile if DNE

  // If module awsm.json doesn't exist, create it
  if (!utils.fileExistsSync(path.join(modulePath, 'awsm.json'))) {
    var moduleTemplateJson = utils.readAndParseJsonSync(path.join(templatesPath, 'module.awsm.json'));
    moduleTemplateJson.name = _this._module.name;
    writeFilesDeferred.push(
        utils.writeFile(
            path.join(modulePath, 'awsm.json'),
            JSON.stringify(moduleTemplateJson, null, 2)));
  }

  // Create action folder
  writeFilesDeferred.push(actionPath);

  // Create action awsm.json
  actionTemplateJson.apiGateway.cloudFormation.Path = _this._module.path;
  actionTemplateJson.apiGateway.cloudFormation.Method = _this._module.method;
  actionTemplateJson.apiGateway.cloudFormation.Type = 'AWS';
  actionTemplateJson.apiGateway.cloudFormation.RequestParameters = _this._module.requestParameters;
  actionTemplateJson.apiGateway.cloudFormation.RequestTemplates = _this._module.requestTemplates;

  if (['lambda', 'both'].indexOf(_this._module.modType) != -1) {
    // Create files for lambda actions
    switch (_this._module.runtime) {
      case 'nodejs':

        // Edit awsm.json
        actionTemplateJson.lambda.cloudFormation.Runtime = 'nodejs';
        actionTemplateJson.lambda.cloudFormation.Handler = path.join(
            'aws_modules',
            _this._module.name,
            _this._module.action,
            'handler.handler');

        // Create handler.js, index.js, event.json, package.json
        var handlerJs = fs.readFileSync(path.join(templatesPath, 'nodejs', 'handler.js'));
        var indexJs = fs.readFileSync(path.join(templatesPath, 'nodejs', 'index.js'));

        writeFilesDeferred.push(
            utils.writeFile(path.join(actionPath, 'handler.js'), handlerJs),
            utils.writeFile(path.join(actionPath, 'index.js'), indexJs),
            utils.writeFile(path.join(actionPath, 'event.json'), '{}')
        );
        break;
      default:
        throw new JawsError('This runtime is not supported "' + _this._module.runtime +
                            '"', JawsError.errorCodes.UNKNOWN);
        break;
    }
  }

  // Trim unnecessary JSON
  if (_this._module.modType === 'lambda') {
    delete actionTemplateJson.apiGateway;
  }

  if (_this._module.modType === 'endpoint') {
    delete actionTemplateJson.lambda;
  }

  // Write Files
  writeFilesDeferred.push(utils.writeFile(path.join(actionPath, 'awsm.json'),
                          JSON.stringify(actionTemplateJson, null, 2)));
  return Promise.all(writeFilesDeferred);
});

function _appendRequestParameters(requestParameters, theParams, type) {
  for (var index in theParams) {
    var p = theParams[index];
    requestParameters['integration.request.' + type + '.' + p] = 'method.request.querystring.' + p;
  }
}

function _appendRequestTemplateVars(requestTemplates, theParams) {
  for (var index in theParams) {
    var p = theParams[index];
    requestTemplates += '\"' + p + '\": \"$input.params(\'' + p + '\')"'
  }
  return requestTemplates;
}

function _extractPathParams(path) {
  return path.split('/')
    .filter(function(segment) {
      return segment[0] === '{' && segment.slice(-1) === '}';
    })
    .map(function(segment) {
      return segment.slice(1, -1);
    });
}
