const http = require("http");
const ffmpeg = require('fluent-ffmpeg');
const exec = require('child_process').exec;
const fs = require("fs");
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
 
createDirIfNotExists(BASE_PATH);
createDirIfNotExists(VIDEO_PATH);
createDirIfNotExists(TS_PATH);
http.createServer(function(req,res) {
    log("============"+new Date()+"============")
    res.writeHead(HTTP_OK,{
        'Content-Type':'text/html;charset=utf-8',//解决中文乱码
        'Access-Content-Allow-Origin':'*'//解决跨域
    });
    // log("referer:"+req.headers.referer)
    // log("url="+req.url)
    if(!req.headers.referer) {//过滤重复请求
        log("Duplicated request!")
        res.end();
        return;
    }
    if(req.url.indexOf("?")==-1 || req.url.indexOf("url")==-1) {
        log("No url detected!")
        res.end("No url detected!");
        return;
        // req.url = "/m3u8Downloader?url=https://www.hkg.haokan333.com/201903/07/qM3F7ntN/800kb/hls/index.m3u8";
    }

    let param = req.url.split("?")[1];
    let url = param.substr(param.indexOf("=")+1);
    log(url)
    
    let filename = new Date().getTime();
    createLogFile(filename);
    // log(req)

    //多线程下载
    downloadM3U8(url,filename).then((resolve,reject) => {
        //m3u8tomp4(path,filename,res);
    }).catch(error => {
        log(error);
    })

    // m3u8tomp4(url,filename,res);
    //生成缩略图
    
    // res.end();
}).listen(PORT);
log('Server start at port '+PORT);

function downloadM3U8(url,filename) {
    return new Promise((resolve,reject) => {
        let tmp = '';//存储ts列表
        if(url) {
            http.request(url,res=>{
                res.on('data',function(data){
                    log(data);
                    tmp += data;
                });
                res.on('end', function() {
                    writeFile(filename+'.m3u8',tmp);
                    // var s = url.lastIndexOf('\/');
                    // var url1 = mid(url,0,s);
                    // writeFile('tsList.txt');
                    // textHandle('tsList.txt',url1+'\/',tmp);
                });
            })

            resolve(["1.ts","2.ts"]);
        }
        else
            // throw new Error('Something failed');
            reject("wrong url!");
    });
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

function createLogFile(filename) {
    let file = VIDEO_PATH+filename+DOWNLOAD_PROGRESS_APPENDIX;
    let cmd = "touch "+file+";chown "+OWNR_WWW_ID+":"+GRP_WWW_ID+" "+file;//修改为docker外部的www用户权限
    execCmd(cmd);
}

function createDir(dirpath) {
    fs.mkdirSync(dirpath,{recursive:true});
    fs.chown(dirpath,OWNR_WWW_ID,GRP_WWW_ID,err=>{
        if(err) log(err)
    });
}

function writeFile(filename,content="") {
    fs.appendFile(filename,content,(err) => {
        if(err) log(err);
        else fs.chown(filename,OWNR_WWW_ID,GRP_WWW_ID,err=>{
            if(err) log(err)
        })
    })
}

function execCmd(cmd) {
    exec(cmd,function(error,stdout,stderr){
        if(error) log(error)
    });
}