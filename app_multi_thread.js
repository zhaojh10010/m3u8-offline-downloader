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
const SERVER_LOG = "server-dev.log"
const TOTAL_THREADS = 50;
const DOWNLOAD_PROGRESS_APPENDIX = ".progress"
const OWNR_WWW_ID = 1000
const GRP_WWW_ID = 1000
const THREAD_MONITOR = {};
 
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

        // m3u8tomp4(TS_PATH+'1629126099644'+"/1629126099644.m3u8",'1629126099644');


        res.end();
    }).listen(port);
    log('Server start at port '+port);
}

function startDownload(requestPath) {
    let fileName = new Date().getTime();
    let tsDir = TS_PATH+fileName;
    let m3u8File = tsDir+'/'+fileName+'.m3u8';
    let progFile = createProgressFile(fileName);
    let url = getUrl(requestPath);
    THREAD_MONITOR[fileName] = TOTAL_THREADS;
    createDirIfNotExists(tsDir);//创建存放ts的文件夹
    //多线程下载
    downloadM3U8(url.realUrl,m3u8File)
    .then(() => {
        downloadTsVideos(url.baseUrl,fileName,m3u8File,progFile)
        .then(() => {
            m3u8tomp4(m3u8File,fileName);
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

async function downloadTsVideos(baseUrl,fileName,m3u8File,progFile) {
    log("=================start downloading "+fileName+".m3u8=============");
    return new Promise((resolve,reject) => {
        let tsUrls = [];
        let tsDir = TS_PATH+fileName;
        let rs = fs.createReadStream(m3u8File);
        //有任何一个出错就集体取消
        const CancelToken = axios.CancelToken;
        const source = CancelToken.source();
        let isCancel = false;
        let lineReader = readline.createInterface(rs);

        let m38uVersion = 3;
        // let idleThreads = TOTAL_THREADS;

        let range = {};
        //按行读取m3u8文件
        lineReader.on('line',line => {
            //EXT-X-KEY EXT-X-MAP
            if(line.indexOf('EXT-X-BYTERANGE')!=-1) {
                let byteRange = line.split(':')[1];
                range.len = byteRange.split('@')[0];
                range.start = byteRange.split('@')[1];
                m38uVersion = 4;
            }
            if(line.endsWith('.ts')) {
                if(m38uVersion==4)
                    tsUrls.push(line+'?start='+range.start+'&end='+(range.len+range.start));
                else
                    tsUrls.push(line);
            }
            if(line.indexOf('#EXT-X-ENDLIST')!=-1) {
                lineReader.close();
            }
        }).on('close',()=>{
            let total = tsUrls.length;
            let progress=0;
            tsUrls.every((url,index) => {
                if(THREAD_MONITOR[fileName]==0) {
                    //等待从数组中获取值
                    await waitForThreads(fileName,isCancel);
                }
                if(isCancel) return false;
                THREAD_MONITOR[fileName]--;
                let target = url;
                if(!url.startsWith('http') && !url.startsWith('www')) {
                    target = baseUrl+url;
                }
                let p = axios.get(target,{
                    cancelToken: source.token,
                    responseType: 'stream'
                });//下载ts
                p.then(res => {
                    THREAD_MONITOR[fileName]++;
                    // let writer = fs.createWriteStream(tsDir+'/'+index+'_'+url);
                    let writer = fs.createWriteStream(tsDir+'/'+url);
                    res.data.pipe(writer);
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
                }).catch(err => {
                    if(!axios.isCancel(err)) {
                        isCancel = true;
                        source.cancel();
                        // isCancel = true;
                        reject();
                        //出错后删除所有ts文件和down文件
                        recrusiveDelete(tsDir);
                        recrusiveDelete(progFile);
                        THREAD_MONITOR[fileName]=0;
                    }
                });
                return true;
            });
        }).on('error',err => {
            log(err);
        });
    });
}

function m3u8tomp4(path,fileName) {
    return new Promise((resolve,reject) => {
        let startTime = new Date();
        ffmpeg(path)
        .on("start",function(commandLine){
            log("exec "+commandLine);
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
            log("Finish converting "+fileName+".mp4");
            let cmd = "chown -R 1000:1000 "+VIDEO_PATH;//修改为docker外部的www用户权限
            execCmd(cmd);
            //删除ts文件
            cmd = "rm -rf "+TS_PATH+fileName;
            execCmd(cmd);
            resolve();
            log("Convertion uses "+(new Date()-startTime)+"ms");
        }).outputOptions("-c copy")//合并m3u8视频
        // .outputOptions("-bsf:a aac_adtstoasc")//将视频转换为mp4
        .output(VIDEO_PATH+fileName+".mp4")
        .run();
    });
}

function waitForThreads(fileName,isCancel) {
    return new Promise((resolve)=>{
        let timer = setInterval(()=>{
            if(THREAD_MONITOR[fileName]>0 || isCancel) {
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

function recrusiveDelete(fileName) {
    /*try {
        if (fs.statSync(fileName).isDirectory()) {
            //读取要删除的目录，获取目录下的文件信息
            let files = fs.readdirSync(fileName);
            //循环遍历要删除的文件
            files.forEach(file => {
                //如果是目录，继续遍历(递归遍历)
                recrusiveDelete(file);
            });
            fs.rmdirSync(fileName);//删除本目录
        } else {
            // 如果是文件，直接删除文件
            fs.unlinkSync(fileName);
        }
    } catch (err) {
        //捕获文件夹不存在的问题
    }*/
    let cmd = "rm -rf "+fileName;
    execCmd(cmd);
}

function execCmd(cmd) {
    exec(cmd,function(error,stdout,stderr){
        if(error) log(error)
    });
}
