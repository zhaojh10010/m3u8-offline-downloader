const http = require("http");
const ffmpeg = require('fluent-ffmpeg');
const exec = require('child_process').exec;
const PORT = 8088;
const HTTP_OK = 200;
const SYMBOL_OVERWRITE = ">";
const SYMBOL_APPEND = ">>";
const BASE_PATH = "/home/ffmpeg/"
const VIDEO_PATH = BASE_PATH+"video/"

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
    
    var filename = new Date().getTime();
    createLogFile(filename);
    // log(req)
    //校验地址是否为m3u8
    m3u8tomp4(url,filename,res);
    //生成缩略图
    
    // res.end();
}).listen(PORT);
log('Server start at PORT '+PORT);

function m3u8tomp4(url,filename,res) {
    return new Promise((resolve, reject) => {
        var i=0;
        ffmpeg(url)
        .on("start",function(commandLine){
            log("exec "+commandLine);
            res.end(JSON.stringify({filename:filename+".log"}));//防阻塞
        }).on("error",error => {
            reject(log(error));
            var cmd = "rm -rf "+VIDEO_PATH+filename+".mp4";//出错后删除未下载完毕的视频文件
            execCmd(cmd);
        }).on("progress",function(progress) {
            if(progress && progress.percent)
                log((i++)+"-"+(progress.percent).toFixed(2)+"%",filename,SYMBOL_OVERWRITE);
            // res.send("<p>Downloading: "+(progress.percent).toFixed(2)+"%</p>");
        }).on("end",()=>{
            log(i+"-100.00%",filename,SYMBOL_OVERWRITE);
            var cmd = "chown -R 1000:1000 "+VIDEO_PATH;//修改为docker外部的www用户权限
            execCmd(cmd);
            resolve();
        }).outputOptions("-c copy")//合并m3u8视频
        .outputOptions("-bsf:a aac_adtstoasc")//将视频转换为mp4
        .output(VIDEO_PATH+filename+".mp4")
        .run();
    });
}

function log(msg,filename,symbol=SYMBOL_APPEND) {
    var cmd = "echo \'"+msg+"\' "+symbol+" "+VIDEO_PATH+filename+".log";
    if(filename==undefined||filename==null||filename=="") {
        cmd = "echo \'"+msg+"\' "+symbol+" "+BASE_PATH+"server.log";
        console.log(msg);
    }
    execCmd(cmd);
}

function createLogFile(filename) {
    var cmd = "touch "+VIDEO_PATH+filename+".log;chown 1000:1000 "+VIDEO_PATH+filename+".log";//修改为docker外部的www用户权限
    execCmd(cmd);
}

function execCmd(cmd) {
    exec(cmd,function(error,stdout,stderr){
        if(error) log(error)
    });
}