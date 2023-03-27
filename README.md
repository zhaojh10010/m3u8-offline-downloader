# M3U8 Downloader
A practice project -> a simple backend for offline m3u8 links downloading using nodejs.

### Installation
This project needs to install ffmpeg docker image, so firstly you need to install docker and start docker process, and then execute
```
docker pull jrottenberg/ffmpeg
```
This docker image is based on Ubuntu 16.

You can use the following command to run a docker container named `myffmpeg`.
```
docker run -itd --name myffmpeg -p 8088:8088 --entrypoint='bash' jrottenberg/ffmpeg
```
And after you ran previous command, you could simply use
```
docker start myffmpeg
```

After you sovled the environment, you can download this project.
```
git clone https://github.com/zhaojh10010/m3u8-offline-downloader.git
```
and then install the dependency modules.
```
cd m3u8-offline-downloader
```
```
npm install
```
when all things are done, just run
```
npm start
```
or
```
node app.js
```
or
```
sh start.sh
```
or
```
./start.sh
```
and the project should be running.

Use `./stop.sh` / `sh stop.sh`(if you use `start.sh`) or `Ctrl + C`(use `npm start` / `node app.js`) to stop the server whenever you want.

### Usage
use GET request
```
http://localhost:8088/download
#params
{
  url='m3u8url.m3u8'
}
```

Or directly type in browers
```
http://localhost:8088/download?url=m3u8url.m3u8
```

remember to replace the param `m3u8url.m3u8` to real download link.

### Other information
- Notify that this project uses `/home/ffmpeg/video` as the video files' log path, you can modify it in `app.js` as you wish.
- Everything is defined in `app.js`, just read and modify it.
- The default server port is `8088`, the server log file is `server.log`.
- This project offers two shell scripts to start (in background) or stop nodejs server.
