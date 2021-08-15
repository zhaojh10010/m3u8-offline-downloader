const http = require('http')
const ffmpeg = require('fluent-ffmpeg');
const exec = require('child_process').exec;
const fs = require("fs");
const axios = require('axios');
const { resolve } = require('path');
const PORT = 11000;
const HTTP_OK = 200;
const BASE_PATH = "/home/ffmpeg/"
const VIDEO_PATH = BASE_PATH+"video/"
const TS_PATH = BASE_PATH+"ts/"
const SERVER_LOG = "server-dev.log"
const TOTAL_THREADS = 50;
const DOWNLOAD_PROGRESS_APPENDIX = ".down"
const OWNR_WWW_ID = 1000
const GRP_WWW_ID = 1000
 
function init() {
    createDirIfNotExists(BASE_PATH);
    createDirIfNotExists(VIDEO_PATH);
    createDirIfNotExists(TS_PATH);
    startServer(PORT);
}
init();

function startServer(port) {
    http.createServer(function(req,res) {
        log("============"+new Date()+"============")
        res.writeHead(HTTP_OK,{
            'Content-Type':'text/html;charset=utf-8',//解决中文乱码
            'Access-Content-Allow-Origin':'*'//解决跨域
        });
        //### 临时处理
        // if(req.headers)
    
        //###
        // log("referer:"+req.headers.referer)
        // log("url="+req.url)
        // if(!req.headers.referer) {//过滤重复请求
        //     log("Duplicated request!");
        //     res.end();
        //     return;
        // }
        if(req.url.indexOf("?")==-1 || req.url.indexOf("url")==-1) {
            log("No url detected!");
            res.end("No url detected!");
            return;
            // req.url = "/m3u8Downloader?url=https://www.hkg.haokan333.com/201903/07/qM3F7ntN/800kb/hls/index.m3u8";
        }
        startDownload(req.url);
        res.end("我好了");
    }).listen(port);
    log('Server start at port '+port);
}

function startDownload(url) {
    let filename = new Date().getTime();
    let m3u8File = TS_PATH+filename+'.m3u8';
    let progFile = createProgressFile(filename);
    let url = getUrl(req.url);//TODO 需要获取baseUrl
    
    //多线程下载
    downloadM3U8(url,m3u8File)
    .then(() => {
        Promise.all(downloadTsVideos(m3u8File,progFile)).then(results => {
                //results.data
                m3u8tomp4(tsFiles,filename,res)
            })
    });
    //生成缩略图
}

function getUrl(url) {
    let param = url.split("?")[1];
    let realUrl = param.substr(param.indexOf("=")+1)
    log("url="+realUrl);
    return realUrl;
}

function downloadM3U8(url,file) {
    return axios.get(url)
            .then(res=>{
                writeFile(file,res.data);
            }).catch(err=>{
                log(err);
            })
}

function downloadTsVideos(m3u8File,progFile) {
    let promises = [];
    // TOTAL_THREADS;
    let rs = fs.createReadStream(m3u8File);
    let baseUrl = "";
    rs.on("data",(data)=>{
        //TODO 每次读取一行

        //拼接成URL下载

        //统一下载到ts中的单独目录下
        
        //根据下载的数量作为进度写入文件(数据库),需要同步写

        //合并成mp4(or 其他)


        let p = axios.get();//下载ts
        promises.push(p);
    }).on("end",()=>{
        // return promises;
    });
    //怎么等所有的promises创建完毕才返回?文件流本身就是同步??
    return promises;
}

function m3u8tomp4(path,filename,res) {
    let i=0;
    ffmpeg(path)
    .on("start",function(commandLine){
        log("exec "+commandLine);
        res.end(JSON.stringify({filename:filename+DOWNLOAD_PROGRESS_APPENDIX}));//防阻塞
    }).on("error",error => {
        let cmd = "rm -rf "+VIDEO_PATH+filename+".mp4";//出错后删除未下载完毕的视频文件
        execCmd(cmd);
        throw new Error(error);//会被外部的Promise catch到
    }).on("progress",function(progress) {
        if(progress && progress.percent)
            writeProgress((i++)+"-"+(progress.percent).toFixed(2)+"%",filename);
        // res.send("<p>Downloading: "+(progress.percent).toFixed(2)+"%</p>");
    }).on("end",()=>{
        writeProgress(i+"-100.00%",filename);
        let cmd = "chown -R 1000:1000 "+VIDEO_PATH;//修改为docker外部的www用户权限
        execCmd(cmd);
    }).outputOptions("-c copy")//合并m3u8视频
    // .outputOptions("-bsf:a aac_adtstoasc")//将视频转换为mp4
    .output(VIDEO_PATH+filename+".mp4")
    .run();
}

function createDirIfNotExists(dirpath) {
    try {
        fs.statSync(dirpath);//同步需要try catch,异步才能用回调
    } catch (error) {
        console.log("Directory "+dirpath+" not exists, automatically created.");
        createDir(dirpath);
    }
}


function writeProgress(msg,filename) {
    let cmd = "echo \'"+msg+"\' > "+VIDEO_PATH+filename+DOWNLOAD_PROGRESS_APPENDIX;
    execCmd(cmd);
}

function log(msg, filename=SERVER_LOG) {
    let cmd = "echo \'"+msg+"\' >> "+BASE_PATH+filename+";chown "+OWNR_WWW_ID+":"+GRP_WWW_ID+" "+BASE_PATH+filename;
    console.log(msg);
    execCmd(cmd);
}

function createProgressFile(filename) {
    let file = VIDEO_PATH+filename+DOWNLOAD_PROGRESS_APPENDIX;
    let cmd = "touch "+file+";chown "+OWNR_WWW_ID+":"+GRP_WWW_ID+" "+file;//修改为docker外部的www用户权限
    execCmd(cmd);
    return file;
}

function createDir(dirpath) {
    fs.mkdirSync(dirpath,{recursive:true});
    fs.chown(dirpath,OWNR_WWW_ID,GRP_WWW_ID,err=>{
        if(err) log(err)
    });
}

function writeFile(filename,content="") {
    fs.promises
    .appendFile(filename,content)
    .then(() => {
        fs.chown(filename,OWNR_WWW_ID,GRP_WWW_ID,err=>{
            if(err) log(err)
        })
    }).catch(err=>{log(err)});
}

function execCmd(cmd) {
    exec(cmd,function(error,stdout,stderr){
        if(error) log(error)
    });
}
