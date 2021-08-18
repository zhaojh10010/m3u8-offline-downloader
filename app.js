const http = require('http')
const ffmpeg = require('fluent-ffmpeg');
const exec = require('child_process').exec;
const fs = require('fs');
const axios = require('axios');
const readline = require('readline');

const PORT = 8088;
const HTTP_OK = 200;
const BASE_PATH = "/home/ffmpeg/"
const VIDEO_PATH = BASE_PATH+"video/"
const TS_PATH = BASE_PATH+"ts/"
const SERVER_LOG = "server.log"
const MAX_REQUESTS = 80;
const DOWNLOAD_PROGRESS_APPENDIX = ".progress"
const OWNR_WWW_ID = 1000
const GRP_WWW_ID = 1000
const TASK_MONITOR = {};
const M3U8_MERGE_FILE = "index.m3u8";

init();
function init() {
    createDirIfNotExists(BASE_PATH);
    createDirIfNotExists(VIDEO_PATH);
    createDirIfNotExists(TS_PATH);
    startServer(PORT);
    // initAxios();
}

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
        log("Requrl: "+req.url);
        if(!req.headers.referer) {//过滤重复请求
            log("Duplicated request!");
            res.end();
            return;
        }
        if(req.url.indexOf("?")==-1 || req.url.indexOf("url")==-1) {
            log("No url detected!");
            res.end("No url detected!");
            return;
            // req.url = "/m3u8Downloader?url=https://www.hkg.haokan333.com/201903/07/qM3F7ntN/800kb/hls/index.m3u8";
        }
        
        
        let fileName = new Date().getTime();
        startDownload(req.url,fileName);
        var fileInfo = {progress:fileName+DOWNLOAD_PROGRESS_APPENDIX,url:"ffmpeg/video/"+fileName+".mp4"};
        res.end(JSON.stringify(fileInfo));
        
        //==========测试=========
        /*let temp = '1629188281496'
        var fileInfo = {progress:temp+DOWNLOAD_PROGRESS_APPENDIX,url:"ffmpeg/video/"+temp+".mp4"};
        m3u8tomp4(TS_PATH+temp+"/test.m3u8",temp);
        res.end(JSON.stringify(fileInfo));*/
        //==========END=========
    }).listen(port);
    log('Server start at port '+port);
}

function startDownload(requestPath,fileName) {
    let tsDir = TS_PATH+fileName;
    let m3u8File = tsDir+'/'+fileName+'.m3u8';
    let m3u8MergeFile = tsDir+'/'+M3U8_MERGE_FILE;
    let progFile = VIDEO_PATH+fileName+DOWNLOAD_PROGRESS_APPENDIX;
    let url = getUrl(requestPath);
    createDirIfNotExists(tsDir);//创建存放ts的文件夹
    writeFile(m3u8File);
    writeFile(progFile);
    TASK_MONITOR[fileName] = {};
    TASK_MONITOR[fileName].available = MAX_REQUESTS;
    TASK_MONITOR[fileName].progress = 0;
    TASK_MONITOR[fileName].retryCount = 0;
    TASK_MONITOR[fileName].isCancel = false;
    TASK_MONITOR[fileName].total = 0;
    TASK_MONITOR[fileName].name = fileName;
    TASK_MONITOR[fileName].tsDir = tsDir;
    TASK_MONITOR[fileName].m3u8File = m3u8File;
    TASK_MONITOR[fileName].m3u8MergeFile = m3u8MergeFile;
    TASK_MONITOR[fileName].progFile = progFile;
    TASK_MONITOR[fileName].url = url;
    TASK_MONITOR[fileName].m38uVersion = 3;
    TASK_MONITOR[fileName].source = axios.CancelToken.source();
    
    //多线程下载
    downloadM3U8(fileName)
    .then(next => {
        let startTime = new Date();
        downloadTsVideos(fileName)
        .then(next => {
            log("Download uses "+parseInt((new Date()-startTime)/1000)+"s");
            m3u8tomp4(fileName);
        },stop => {
            log(stop);
        });
    },stop => {
        log(stop);
    });
}

function getUrl(url) {
    let param = url.substr(url.indexOf("?")+1);
    let realUrl = param.substr(param.indexOf("=")+1);
    //https://www.hkg.haokan333.com/201903/07/qM3F7ntN/800kb/hls/index.m3u8
    let parsedUrl = new URL(realUrl);
    //TODO 解析路径
    let path = parsedUrl.pathname.substr(0,parsedUrl.pathname.lastIndexOf("/"));
    return {baseUrl:parsedUrl.origin+path+"/",realUrl:parsedUrl.href};
}

function downloadM3U8(fileName) {
    log("============Request "+TASK_MONITOR[fileName].url.realUrl+"================");
    return new Promise((resolve,reject) => {
        axios.get(TASK_MONITOR[fileName].url.realUrl)
            .then(res => {
                writeFile(TASK_MONITOR[fileName].m3u8File,res.data);
                resolve();
            }).catch(err => {
                log("Http err:");
                log(err);
                reject("Download m3u8 failed.");
            });
    });
}

function downloadTsVideos(fileName) {
    log("=================Start downloading "+fileName+".m3u8=================");
    return new Promise((resolve,reject) => {
        let rs = fs.createReadStream(TASK_MONITOR[fileName].m3u8File);
        let lineReader = readline.createInterface(rs);

        let i=0;//文件索引
        let downloadInfos = [];
        //按行读取m3u8文件
        lineReader.on('line',line => {
            //TODO EXT-X-KEY EXT-X-MAP
            if(!downloadInfos[i])
                downloadInfos[i] = {index:i};
            if(line.indexOf('EXT-X-BYTERANGE') != -1) {
                let byteRange = line.split(':')[1];
                var range = {};
                range.len = byteRange.split('@')[0]*1;
                range.start = byteRange.split('@')[1]*1;
                range.end = range.start+range.len;
                downloadInfos[i].range = range;
                TASK_MONITOR[fileName].m38uVersion = 4;
            }
            if(line.indexOf('.ts')!=-1) {
                downloadInfos[i].url = line;
                writeFile(TASK_MONITOR[fileName].m3u8MergeFile,'file \''+TASK_MONITOR[fileName].tsDir+'/'+i+'.ts\'\n');
                i++;
            }
            if(line.indexOf('#EXT-X-ENDLIST')!=-1 && !downloadInfos[i].url)
                downloadInfos.pop();
        }).on('close',() => {
            TASK_MONITOR[fileName].total = downloadInfos.length;
            log('totalUrls:'+TASK_MONITOR[fileName].total);
            downloadVideo(downloadInfos,fileName,resolve,reject);
            // log(downloadInfos[downloadInfos.length-1]);
        }).on('error',err => {
            log("reading stream err:");
            log(err);
        });
    });
}

function downloadVideo(downloadInfos,fileName,pResolve,pReject) {
    //有任何一个出错就集体取消,但是允许重试3次
    let retryDownloadInfos = [];
    
    let total = downloadInfos.length;
    downloadInfos.every(async (downloadInfo,index) => {
        if(TASK_MONITOR[fileName].available==0) {
            //等待从数组中获取值
            await waitForThreads(fileName);
        }
        if(TASK_MONITOR[fileName].isCancel) return false;
        TASK_MONITOR[fileName].available--;
        let target = downloadInfo.url;
        if(!downloadInfo.url.startsWith('http') && !downloadInfo.url.startsWith('www')) {
            target = TASK_MONITOR[fileName].url.baseUrl+downloadInfo.url;
        }
        let p = axios.get(target,{
            cancelToken: TASK_MONITOR[fileName].source.token,
            responseType: 'stream',
            headers: {
                'range': TASK_MONITOR[fileName].m38uVersion === 4?'bytes='+downloadInfo.range.start+'-'+downloadInfo.range.end:''
            },
            timeout: 180000//超时时间180s
        });//下载ts
        p.then(res => {
            TASK_MONITOR[fileName].available++;
            let writer = fs.createWriteStream(TASK_MONITOR[fileName].tsDir+'/'+downloadInfo.index+'.ts');
            // let writer = fs.createWriteStream(tsDir+'/'+url);
            res.data.pipe(writer);
            writer.on('close',() => {
                try {
                    if(TASK_MONITOR[fileName].progress==0||TASK_MONITOR[fileName].progress==parseInt(TASK_MONITOR[fileName].total/2))
                        log('Downloading: '+((TASK_MONITOR[fileName].progress/TASK_MONITOR[fileName].total)*100).toFixed(2)+'%');
                    TASK_MONITOR[fileName].progress++;
                    fs.writeFileSync(TASK_MONITOR[fileName].progFile,((TASK_MONITOR[fileName].progress/TASK_MONITOR[fileName].total)*100).toFixed(2)+'%');
                } catch (err) {
                    log("write progFile error:");
                    log(err);
                }
                if(TASK_MONITOR[fileName].progress==TASK_MONITOR[fileName].total) {
                    // 转换成mp4
                    log('Downloading: 100.00%');
                    log("=================Download "+fileName+".m3u8 list successfully=================");
                    pResolve();
                }
            });
        }).catch(err => {
            if((err.code=='ETIMEDOUT' || err.code=='ECONNRESET') && TASK_MONITOR[fileName].retryCount<3) {//重试3次
                log("Retry time:"+TASK_MONITOR[fileName].retryCount);
                retryDownloadInfos.push(downloadInfo);
                if(index==total) {//到最后一个链接才执行
                    TASK_MONITOR[fileName].retryCount++;
                    downloadVideo(retryDownloadInfos,fileName,pResolve,pReject);
                }
            } else {
                cancelDownload(fileName);
                log("Http download err: download "+downloadInfo.url+" failed -> range: bytes="+downloadInfo.range.start+"-"+downloadInfo.range.end);
                log(err);
                pReject("Download videos failed, check the errors");
            }
            if(err.code=='ECONNABORTED') {//cancel导致
                
            }
        });
        return true;
    });
}

function cancelDownload(fileName) {
    if(!TASK_MONITOR[fileName].isCancel) {
        TASK_MONITOR[fileName].isCancel = true;
        TASK_MONITOR[fileName].source.cancel();
        TASK_MONITOR[fileName].available=0;
        //出错后删除所有ts文件和progress文件
        recrusiveDelete(TASK_MONITOR[fileName].tsDir);
        recrusiveDelete(TASK_MONITOR[fileName].progFile);
        TASK_MONITOR[fileName] = undefined;
    }
}

function m3u8tomp4(fileName) {
    log("=================Start converting ts into mp4=================");
    return new Promise((resolve,reject) => {
        let startTime = new Date();
        ffmpeg(TASK_MONITOR[fileName].m3u8MergeFile)
        .on("start",function(commandLine){
            log("exec "+commandLine);
            //ffmpeg -f concat -safe 0 -i /home/ffmpeg/ts/1629188281496/test.m3u8 -y -c copy /home/ffmpeg/video/1629188281496.mp4
        }).on("error",error => {
            log("convertion err:");
            log(error)
            // let cmd = "rm -rf "+TS_PATH+fileName+";rm -f "+VIDEO_PATH+fileName+DOWNLOAD_PROGRESS_APPENDIX;//出错后删除未下载完毕的视频文件和进度
            // execCmd(cmd);
        }).on("progress",function(progress) {
            //转换时没有用
        }).on("end",() => {
            log("Finish converting "+fileName+".mp4");
            let cmd = "chown -R 1000:1000 "+VIDEO_PATH;//修改为docker外部的www用户权限
            execCmd(cmd);
            //删除ts文件
            cmd = "rm -rf "+TASK_MONITOR[fileName].tsDir;
            execCmd(cmd);
            resolve();
            log("Convertion uses "+parseInt((new Date()-startTime)/1000)+"s");
        }).inputOptions("-f concat")
        .inputOptions("-safe 0")
        .outputOptions("-c copy")//合并m3u8视频
        // .outputOptions("-bsf:a aac_adtstoasc")//将视频转换为mp4
        .output(VIDEO_PATH+fileName+".mp4")
        .run();
    });
}

function waitForThreads(fileName) {
    return new Promise((resolve) => {
        let timer = setInterval(() => {
            if(TASK_MONITOR[fileName].available > MAX_REQUESTS/2 || TASK_MONITOR[fileName].isCancel) {
                resolve();
                clearInterval(timer);
            }
        },1000);
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
    //TODO 怎么把msg用echo写入
    let cmd = "echo \'"+JSON.stringify(msg).replace(/\"/g,'')+"\' >> "+BASE_PATH+fileName+";chown "+OWNR_WWW_ID+":"+GRP_WWW_ID+" "+BASE_PATH+fileName;
    console.log(msg);
    execCmd(cmd);
}

function createDir(dirpath) {
    fs.mkdirSync(dirpath,{recursive:true});
    fs.chown(dirpath,OWNR_WWW_ID,GRP_WWW_ID,err=>{
        if(err) log(err)
    });
}

function writeFile(fileName,content="") {
    try {
        fs.appendFileSync(fileName,content)
    } catch (err) {
        log(err);
    }
    fs.chown(fileName,OWNR_WWW_ID,GRP_WWW_ID,err=>{
        if(err) log(err)
    })
    
}

function recrusiveDelete(fileName) {
    let cmd = "rm -rf "+fileName;
    execCmd(cmd);
}

function execCmd(cmd) {
    exec(cmd,function(error,stdout,stderr){
        if(error) log(error)
    });
}
