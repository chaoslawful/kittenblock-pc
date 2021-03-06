/**
 * Created by Riven on 2016/12/15.
 */
"use strict";
var path = require('path');
var fs = require('fs');
var EventEmitter = require('events');
var SerialConnection = require('./SerialConnection');
var UpdateManager = require('./UpdaterManager');
var ArduinoManager = require('./ArduinoManager');
var Toolbox = require('./Toolbox');
var ResourceManager = require('./ResourceManager');
var ConfigManager = require('./ConfigManager');
var PluginManager = require('./PluginManager');
var ProjectManager = require('./ProjectManager');
var NetworkConnection = require('./NetConnection');


var KittenBlock = function () {
    var instance = this;
    this.pluginpath = path.resolve(process.cwd(),'plugins');
    this.workpath = path.resolve(process.cwd(),'workspace');
    this.mediapath = path.resolve(process.cwd(),'media');
    this.defaultExamples = path.resolve(process.cwd(),'examples');
    this.arduinoPath = path.resolve(process.cwd(),'arduino'); // not the one where arduino ide locate
    this.updatePath = path.resolve(process.cwd());

    instance.configmng  = new ConfigManager();
    this.config = this.configmng.load();
    this.config.arduino.path = this.arduinoPath;
    this.config.version = "1.11"; // don't read from config file any more

    instance.serial = new SerialConnection();
    instance.updater = new UpdateManager();
    instance.arduino = new ArduinoManager(this.config.arduino);
    instance.toolbox = new Toolbox();
    instance.resourcemng = new ResourceManager();
    instance.pluginmng = new PluginManager(this.pluginpath,this.config.enabledPlugin);
    instance.proj = new ProjectManager(this.workpath);
    instance.net  = new NetworkConnection();

    this.connectedPort = null;
    this.portList = [];
    this.resourcemng.startServer(this.workpath,this.mediapath);
    this.pluginlist = this.pluginmng.enumPlugins();

};

KittenBlock.prototype.connectPort = function (port,successCb,readlineCb,closeCb,onRecv) {
    var _this = this;
    if(port.type=='serial'){
        var ser = this.serial;
        ser.connect(port.path,{bitrate: this.config.arduino.baudrate},function (ret) {
            if(ret!=-1) {
                ser.onReadLine.addListener(readlineCb);
                ser.onDisconnect.addListener(function () {
                    _this.connectedPort = null;

                    closeCb();
                });
                _this.connectedPort = {"path": port.path, "type": "serial"};
                _this.arduino.lastSerialPort = port.path;
                _this.config.arduino.lastSerialPort = port.path;
                _this.saveConfig();
                successCb(port.path);
            }
        },onRecv);
    }else if(port.type=='net'){
        this.net.promoteIpDialog(function (connectedPort) {
            _this.connectedPort = {"path": connectedPort, "type": "net"};
            successCb(connectedPort);
        },port.ip,readlineCb,closeCb);
    }
};

KittenBlock.prototype.disonnectPort = function (callback) {
    if(this.connectedPort==null) return;
    if(this.connectedPort.type=='serial'){
        this.serial.disconnect(callback);
    }else if(this.connectedPort.type=='net'){
        this.net.disconnect(callback);
        this.connectedPort = null;
    }
};

KittenBlock.prototype.sendCmd = function (data) {
    if(this.connectedPort && this.connectedPort.type=='serial'){
        if(data instanceof Uint8Array){
            this.serial.sendbuf(data.buffer);
        }else{
            this.serial.send(data+'\r\n');
        }
    }else if(this.connectedPort && this.connectedPort.type=='net'){
        this.net.sendCmd(data);
    }
};

KittenBlock.prototype.enumPort = function (callback) {
    var kb = this;
    kb.portList = [];
    for(var key in this.net.robotlist){
        var ip = this.net.robotlist[key];
        key = key+":"+ip;
        var port = {"path":key,"type":'net','ip':ip};
        this.portList.push(port);
    }
    this.serial.enumSerial(function (devices) {
        devices.forEach(function (dev) {
            var port = {"path":dev.path,"type":'serial'};
            kb.portList.push(port);
        });
        if(callback) callback(kb.portList);
    });

    this.net.pingRobot();
};

KittenBlock.prototype.getUpdate = function (callback) {
    this.updater.getServer(callback);
};

KittenBlock.prototype.loadDefaultProj = function () {
    var projfile = path.resolve(this.defaultExamples,"kittenbot.sb2");
    this.proj.loadsb2(projfile);
};

KittenBlock.prototype.loadFirmware = function (inopath) {
    if(!inopath) {
        var inopath = path.resolve(this.arduinoPath, "\kb_firmware", "kb_firmware.ino")
    }
    return this.arduino.loadFactoryFirmware(inopath);
};

KittenBlock.prototype.openIno = function (code) {
    var workspaceFolder = path.resolve(this.workpath,"\project");
    var workspaceIno = path.resolve(this.workpath,"\project","project.ino");
    if (!fs.existsSync(workspaceFolder)){
        fs.mkdirSync(workspaceFolder);
    }
    this.arduino.openArduinoIde(code,workspaceIno);
};

KittenBlock.prototype.uploadProject = function (code,logCb,finishCb) {
    var workspaceFolder = path.resolve(this.workpath,"\project");
    var workspaceIno = path.resolve(this.workpath,"\project","project.ino");
    if(this.serial.connectionId!=-1){
        this.serial.disconnect();
    }
    if (!fs.existsSync(workspaceFolder)){
        fs.mkdirSync(workspaceFolder);
    }
    this.arduino.uploadProject(code,workspaceIno,logCb,finishCb);
};

KittenBlock.prototype.loadSb2 = function (filepath) {
    return this.proj.loadsb2(filepath);
};

KittenBlock.prototype.copyArduinoLibrary = function (srcpath) {
    if(!srcpath){
        srcpath = path.resolve(this.arduinoPath,'lib/')
    }
    this.arduino.copyLibrary(srcpath);
};

KittenBlock.prototype.loadPlugin = function (pluginName,vmruntime) {
    this.pluginmodule = this.pluginmng.loadPlugins(pluginName,vmruntime);
    this.plugin = new (this.pluginmodule)(this);
};

KittenBlock.prototype.saveConfig = function () {
    this.configmng.save(this.config);
};

KittenBlock.prototype.reloadApp = function () {
    document.location.reload(true); // reload all
};

KittenBlock.prototype.loadKb = function (kbpath) {
    return this.proj.loadkb(kbpath);
};

KittenBlock.prototype.saveKb = function (kbpath,xml) {
    return this.proj.savekb(kbpath,xml);
};

KittenBlock.prototype.selectPlugin = function (plugin) {
    this.config.enabledPlugin = plugin;
    this.pluginmng.enabled = plugin;
    this.pluginlist = this.pluginmng.enumPlugins();
    return this.pluginlist;
};

KittenBlock.prototype.setPluginParseLine = function (func) {
    this.arduino.pluginPareLine = func;
};

KittenBlock.prototype.selectBoard = function (board) {
    this.config.arduino.board = board.type;
    this.arduino.arduinoboard = this.config.arduino.board;
    this.saveConfig();
};

KittenBlock.prototype.copyResourceToWorkspace = function (resourceMd5) {
    this.resourcemng.copyToWorkspace(resourceMd5,this.mediapath,this.workpath);
};

KittenBlock.prototype.doUpdate = function (updater,updateDone,updateProgress) {
    this.updater.doUpdate(updater.path,this.updatePath,updateDone,updateProgress);
};

module.exports = KittenBlock;
