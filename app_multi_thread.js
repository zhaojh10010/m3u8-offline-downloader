const http = require('http')
const ffmpeg = require('fluent-ffmpeg');
const exec = require('child_process').exec;
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const rax = require('retry-axios');
const readline = require('readline');
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
    // initAxios();
}
init();

function initAxios() {
    axios.defaults.retry = 5;
    axios.defaults.retryDelay = 1000;
    axios.defaults.shouldRetry = (err) => true;//只要是错误就重试
    axios.interceptors.response.use(function (response) {
        return response;
    }, function (error) {
        //检查重试配置
        let config = err.config;
        if(!config || !config.retry) return Promise.reject(error);
        if(!config.shouldRetry || typeof config.shouldRetry != 'function') {
            return Promise.reject(err);
        }
        //判断重试次数
        if(!config.shouldRetry(err)) {
            return Promise.reject(err);
        }
        //设置默认重置次数为0
        config.__retryCount = config.__retryCount || 0;
        //判断是否超过了重试次数
        if(config.__retryCount >= config.retry) {
            return Promise.reject(err);
        }
        //重试次数自增
        config.__retryCount += 1;
        //延时处理
        let backoff = new Promise(function(resolve) {
            setTimeout(function() {
                resolve();
            }, config.retryDelay || 1);
        });
        //重新发起axios请求
        return backoff.then(function() {
            return axios(config);
        });
    });
}

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

        // m3u8tomp4(TS_PATH+'1629120797920'+"1629120797920.m3u8",'1629120797920');


        res.end("我好了");
    }).listen(port);
    log('Server start at port '+port);
}

function startDownload(requestPath) {
    let fileName = new Date().getTime();
    let tsDir = TS_PATH+fileName;
    let m3u8File = tsDir+'/'+fileName+'.m3u8';
    let progFile = createProgressFile(fileName);
    let url = getUrl(requestPath);
    createDirIfNotExists(tsDir);//创建存放ts的文件夹
    //多线程下载
    downloadM3U8(url.realUrl,m3u8File)
    .then(() => {
        downloadTsVideos(url.baseUrl,fileName,m3u8File,progFile)
        .then(() => {
            console.log("========res=======",tsDir);
            //TODO 合并成mp4(or 其他)
            m3u8tomp4(m3u8File);
        });
    });
    //生成缩略图
}

function getUrl(url) {
    let param = url.split("?")[1];
    let realUrl = param.substr(param.indexOf("=")+1);
    // log("url="+realUrl);
    //https://www.hkg.haokan333.com/201903/07/qM3F7ntN/800kb/hls/index.m3u8
    let parsedUrl = new URL(realUrl);
    //TODO 解析路径
    let path = parsedUrl.pathname.substr(0,parsedUrl.pathname.lastIndexOf("/"));
    console.log(path);
    return {baseUrl:parsedUrl.origin+path+"/",realUrl:parsedUrl.href};
}

function downloadM3U8(url,file) {
    return axios.get(url)
            .then(res=>{
                writeFile(file,res.data);
            }).catch(err=>{
                log(err);
            });

}

function downloadTsVideos(baseUrl,fileName,m3u8File,progFile) {
    log("=================start downloading"+m3u8File+"=============");
    return new Promise((resolve,reject) => {
        let tsUrls = [];
        let tsDir = TS_PATH+fileName;
        let rs = fs.createReadStream(m3u8File);
        //有任何一个出错就集体取消
        const CancelToken = axios.CancelToken;
        const source = CancelToken.source();
        let writeCancel = false;
        let lineReader = readline.createInterface(rs);

        // let total = TOTAL_THREADS;
        //按行读取m3u8文件
        lineReader.on('line',line => {
            if(line.endsWith('.ts')) {
                tsUrls.push(line);
            }
        }).on('close',()=>{
            let total = tsUrls.length;
            let progress=0;
            tsUrls.forEach((url,index) => {
                let target = url;
                if(!url.startsWith('http') && !url.startsWith('www'))
                    target = baseUrl+url;
                let p = axios.get(target,{
                    cancelToken: source.token
                });//下载ts
                p.then(res => {
                    // let writer = fs.createWriteStream(tsDir+'/'+index+'_'+url);
                    let writer = fs.createWriteStream(tsDir+'/'+url);
                    writer.write(res.data);
                    writer.on('close',() => {
                        try {
                            progress+=1;
                            log(((progress/total)*100).toFixed(2)+'%');
                            fs.writeFileSync(progFile,((progress/total)*100).toFixed(2)+'%');
                        } catch (err) {
                            log("write error:",err);
                        }
                        if(progress==total) {
                            // 转换成mp4
                            resolve();
                        }
                    });
                    writer.end();
                }).catch(err => {
                    if(!axios.isCancel(err)) {
                        source.cancel();
                        // writeCancel = true;
                        reject();
                        //出错后删除所有ts文件和down文件
                        recrusiveUnlink(tsDir);
                        recrusiveUnlink(progFile);
                    }
                });
            });
        }).on('error',err => {
            log(err);
            lineReader.close();
        });
    });
}

function m3u8tomp4(path,fileName) {
    ffmpeg(path)
    .on("start",function(commandLine){
        log("exec "+commandLine);
        // res.end(JSON.stringify({fileName:fileName+DOWNLOAD_PROGRESS_APPENDIX}));//防阻塞
    }).on("error",error => {
        log(error)
        // let cmd = "rm -rf "+path+".mp4";//出错后删除未下载完毕的视频文件
        // execCmd(cmd);
        // throw new Error(error);//会被外部的Promise catch到
    }).on("progress",function(progress) {
        // if(progress && progress.percent)
        //     writeProgress((i++)+"-"+(progress.percent).toFixed(2)+"%",fileName);
    }).on("end",()=>{
        // writeProgress(i+"-100.00%",fileName);
        let cmd = "chown -R 1000:1000 "+VIDEO_PATH;//修改为docker外部的www用户权限
        execCmd(cmd);
    }).outputOptions("-c copy")//合并m3u8视频
    // .outputOptions("-bsf:a aac_adtstoasc")//将视频转换为mp4
    .output(VIDEO_PATH+fileName+".mp4")
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
    let file = VIDEO_PATH+fileName+DOWNLOAD_PROGRESS_APPENDIX;
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

function writeFile(fileName,content="") {
    fs.promises
    .appendFile(fileName,content)
    .then(() => {
        fs.chown(fileName,OWNR_WWW_ID,GRP_WWW_ID,err=>{
            if(err) log(err)
        })
    }).catch(err=>{log(err)});
}

function recrusiveUnlink(fileName) {
    try {
        if (fs.statSync(fileName).isDirectory()) {
            //读取要删除的目录，获取目录下的文件信息
            let files = fs.readdirSync(fileName);
            //循环遍历要删除的文件
            files.forEach(file => {
                //如果是目录，继续遍历(递归遍历)
                recrusiveUnlink(file);
            });
            fs.rmdirSync(fileName);//删除本目录
        } else {
            // 如果是文件，直接删除文件
            fs.unlinkSync(fileName);
        }
    } catch (err) {
        //捕获文件夹不存在的问题
    }
}

function execCmd(cmd) {
    exec(cmd,function(error,stdout,stderr){
        if(error) log(error)
    });
}
