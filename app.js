const http = require("http");
const ffmpeg = require('fluent-ffmpeg');
const exec = require('child_process').exec;
const fs = require('fs');

const PORT = 8088;
const HTTP_OK = 200;
const BASE_PATH = "/home/ffmpeg/"
const VIDEO_PATH = BASE_PATH+"video/"
const SERVER_LOG = "server.log"
const DOWNLOAD_PROGRESS_APPENDIX = ".progress"
const OWNR_WWW_ID = 1000
const GRP_WWW_ID = 1000

createDirIfNotExists(BASE_PATH);
createDirIfNotExists(VIDEO_PATH);
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
        res.end("No url detected!");
        return;
        // req.url = "/m3u8Downloader?url=https://www.hkg.haokan333.com/201903/07/qM3F7ntN/800kb/hls/index.m3u8";
    }
    //https://www.hkg.haokan333.com/201903/07/qM3F7ntN/800kb/hls/index.m3u8
    //https://ca2rtj3wixcfoope5ch0.nincontent.com/T2tubEJucmdiK3lSeVl0YmVmQmw1N0pTeEc1UHdiRkhrU2w3LzRYODVybWdkc3JKSVJDVWl3M1dEaDRsMDA0Vkl0djQ5ajVJVTZtbHp4ZllvU0YxMEtGN1NEaGxCK1JFK3RUVVJWeTNiMURTQ1ZrRS8rYk50ZllyUnNBQVpyMTVEZTRBZjZMbDcyZnp1Qk1kOE5vUklBPT0=/asXCgAhn5bp-yksCVyJJvA/2_720p.m3u8
    // var param = {};
    // var params = req.url.split("?")[1];
    // params.split("&").forEach(item => {
    //     var p = item.split("=");
    //     param[p[0]] = p[1];
    // });
    // var url = param['url'];
    var param = req.url.split("?")[1];
    var url = param.substr(param.indexOf("=")+1);
    log(url)
    
    var fileName = new Date().getTime();
    createProgressFile(fileName);
    // log(req)
    m3u8tomp4(url,fileName,res);
    //TODO 生成缩略图
    
    res.end(JSON.stringify({fileName:fileName+DOWNLOAD_PROGRESS_APPENDIX}));
}).listen(PORT);
log('Server start at PORT '+PORT);

function m3u8tomp4(url,fileName,res) {
    return new Promise((resolve, reject) => {
        var i=0;
        ffmpeg(url)
        .on("start",function(commandLine){
            log("exec "+commandLine);
        }).on("error",error => {
            reject(log(error));
            var cmd = "rm -rf "+VIDEO_PATH+fileName+".mp4 "+fileName+DOWNLOAD_PROGRESS_APPENDIX;//出错后删除未下载完毕的视频文件
            execCmd(cmd);
        }).on("progress",function(progress) {
            if(progress && progress.percent)
                writeProgress((i++)+"-"+(progress.percent).toFixed(2)+"%",fileName);
            // res.send("<p>Downloading: "+(progress.percent).toFixed(2)+"%</p>");
        }).on("end",()=>{
            writeProgress(i+"-100.00%",fileName);
            log("Finish converting "+fileName+".mp4");
            var cmd = "chown -R 1000:1000 "+VIDEO_PATH;//修改为docker外部的www用户权限
            execCmd(cmd);
            resolve();
        }).outputOptions("-c copy")//合并m3u8视频
        .outputOptions("-bsf:a aac_adtstoasc")//将视频转换为mp4
        .output(VIDEO_PATH+fileName+".mp4")
        .run();
    });
}

function createDirIfNotExists(dirpath) {
    try {
        fs.statSync(dirpath);//同步需要try catch,异步才能用回调
    } catch (error) {
        console.log("Directory "+dirpath+" not exists, automatically created.");
        createDir(dirpath);
    }
}

function writeProgress(msg,fileName) {
    let cmd = "echo \'"+msg+"\' > "+VIDEO_PATH+fileName+DOWNLOAD_PROGRESS_APPENDIX;
    execCmd(cmd);
}

function log(msg, fileName=SERVER_LOG) {
    let cmd = "echo \'"+msg+"\' >> "+BASE_PATH+fileName+";chown "+OWNR_WWW_ID+":"+GRP_WWW_ID+" "+BASE_PATH+fileName;
    console.log(msg);
    execCmd(cmd);
}

function createProgressFile(fileName) {
    var cmd = "touch "+VIDEO_PATH+fileName+".progress;chown 1000:1000 "+VIDEO_PATH+fileName+".progress";//修改为docker外部的www用户权限
    execCmd(cmd);
}

function createDir(dirpath) {
    fs.mkdirSync(dirpath,{recursive:true});
    fs.chown(dirpath,OWNR_WWW_ID,GRP_WWW_ID,err=>{
        if(err) log(err)
    });
}

function execCmd(cmd) {
    exec(cmd,function(error,stdout,stderr){
        if(error) log(error)
    });
}