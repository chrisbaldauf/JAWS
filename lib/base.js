'use strict';

const path = require('path'),
    utils = require('./utils/index'),
    JawsCLI = require('./utils/cli'),
    JawsError = require('./jaws-error'),
    Promise = require('bluebird'),
    AWSUtils = require('./utils/aws');

/**
 * Base Class
 */

class Base {

  constructor() {

    let _this = this;

    // Add meta data
    this._interactive = process.stdout.isTTY;
    this._version = require('./../package.json').version;
    this._projectRootPath = utils.findProjectRootPath(process.cwd());
    this._projectJson = false;
    this._queue = [];

    // If within project, add further meta data
    if (this._projectRootPath) {

      this._projectJson = require(this._projectRootPath + '/jaws.json');

      // Load Plugins
      this._loadPlugins(this._projectJson.plugins);

      // Load Admin ENV information
      // Don't display dotenv load failures for admin.env if we already have the required environment variables
      let silent = !!process.env.ADMIN_AWS_PROFILE;
      require('dotenv').config({
        silent: silent,
        path: path.join(this._projectRootPath, 'admin.env'),
      });
      this._profile = process.env.ADMIN_AWS_PROFILE;
      this._credentials = AWSUtils.profilesGet(this._profile)[this._profile];
    }

    // Create registry for actions, with defaults
    this.actions = {
      ProjectCreate:                  function *() { yield 'hello' },
      StageCreate:                    null,
      RegionCreate:                   null,
      ModuleCreate:                   null,
      ModulePostInstall:              null,
      LambdaPackage:                  null,
      LambdaUpload:                   null,
      LambdaProvision:                null,
      LambdaDeploy:                   null,
      ApiGatewayProvision:            null,
      ResourcesProvision:             null,
      EnvList:                        null,
      EnvGet:                         null,
      EnvSet:                         null,
      TagResource:                    null,
      LambdaRun:                      null,
      Dash:                           null,
    };

    // Create registry for hooks
    this.hooks = {
      PreProjectCreate:               [],
      PostProjectCreate:              [],
      PreStageCreate:                 [],
      PostStageCreate:                [],
      PreRegionCreate:                [],
      PostRegionCreate:               [],
      PreModuleCreate:                [],
      PostModuleCreate:               [],
      PreModulePostInstall:           [],
      PostModulePostInstall:          [],
      PreLambdaPackage:               [],
      PostLambdaPackage:              [],
      PreLambdaUpload:                [],
      PostLambdaUpload:               [],
      PreLambdaProvision:             [],
      PostLambdaProvision:            [],
      PreApiGatewayProvision:         [],
      PostApiGatewayProvision:        [],
      PreResourcesProvision:          [],
      PostResourcesProvision:         [],
      PreEnvList:                     [],
      PostEnvList:                    [],
      PreEnvGet:                      [],
      PostEnvGet:                     [],
      PreEnvSet:                      [],
      PostEnvSet:                     [],
      PreTagResource:                 [],
      PostTagResource:                [],
      PreLambdaRun:                   [],
      PostLambdaRun:                  [],
      PreDash:                        [],
      PostDash:                       [],
    };

    // If within project, load plugins
    if (this._projectRootPath) {
      this._loadPlugins(this._projectJson.plugins);
    }
  }

  /**
   * Update Config
   * @param config
   */

  config(config) {

    // Update JAWS with config properties

    // Load Plugins
    if (config.plugins) {
      this._loadPlugins(config.plugins);
    }

  }

  /**
   * Set Action
   */

  action(actionName, actionGenerator) {

    // Check action is valid
    if (!this.actions[actionName]) {

    }

    this.action[actionName] = actionGenerator;
  }

  /**
   * Set Hook
   */

  hook(hookName, hookGenerator, index) {

    // Check hook is valid
    if (!this.hooks[hookName]) {

    }

    index = (!index && index !== 0) ? this.hooks[hookName].length : index;
    this.hooks[hookName].splice(index, 0, hookGenerator);
  }

  /**
   * Set Plugin
   */

  plugin(pluginHandler, config) {
    pluginHandler(this, config);
  }

  /**
   * Project Create
   * @returns {*}
   */

  projectCreate() {
    let projectCreate = require('./actions/ProjectCreate');
    let action = new projectCreate();
    action.execute();
  }

  /**
   * Load Plugins
   */

  _loadPlugins(plugins) {

    let pluginArray = Object.keys(plugins);

    for (let i in pluginArray) {
      pluginArray[i](plugins[pluginArray[i]]).bind(this);
    }
  }

  /**
   * Execute Queue
   * - Runs an array of generator functions
   * - The yield* operator lets you call another generator from within a generator
   */

  _executeQueue(queue) {
    console.log('Running queue... ', queue);
    function *noop(){}

    return function *(next){
      if (!next) next = noop();

      var i = genArray.length;

      while (i--) {
        next = queue[i].call(this, next);
      }

      yield *next;
    }
  }
}

module.exports = Base;