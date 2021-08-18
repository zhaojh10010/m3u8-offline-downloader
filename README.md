# M3U8 Downloader
A simple backend for offline m3u8 links downloading using nodejs.

### Installation
This project needs to install ffmpeg docker image, so firstly you need to install docker and start docker process, and then execute
```
docker pull jrottenberg/ffmpeg
```
This docker image is based on Ubuntu 16.

You can use the following command to run a docker container named `myffmpeg`.
```
docker run -it --name myffmpeg -p 8088:8088 --entrypoint='bash' jrottenberg/ffmpeg
```
And after you ran previous command, you could simply use
```
docker run myffmpeg
```

After you sovled the environment, just run
```
npm start
or
node app.js
or
sh start.sh
or
./start.sh
```
and the project should be running.

Use `./stop.sh or sh stop.sh` to stop the server whenever you want.

### Usage
Just input a url with the param `url` and replace the `m3u8url.m3u8` by your url.
```
https://yourserverdomian:8088/requestpath?url=m3u8url.m3u8
```

### Other information
- Notify that this project uses `/home/ffmpeg/video` as the video files' log path, you can modify it in `app.js` as you wish.
- Everything is defined in `app.js`, just read and modify it.
- The default server port is `8088`, the server log file is `server.log`.
- This project offers two shell scripts to start (in background) or stop nodejs server.
