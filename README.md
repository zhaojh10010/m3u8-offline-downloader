## M3U8 Downloader
A simple backend for offline m3u8 links downloading using nodejs.

### How to use
This project needs to install ffmpeg docker image, so firstly you need to install docker and start docker process, and then execute
```
docker pull jrottenberg/ffmpeg
```
This docker image is based on Ubuntu 16.

You can use 
```
docker run -it --name myffmpeg -p 8088:8088 --entrypoint='bash' jrottenberg/ffmpeg
```
to run a docker container named `myffmpeg`, and after you run this command, you can simply use
```
docker run myffmpeg
```
to run the container.

Notify that this project uses `/home/ffmpeg/video` as the video files' log path, you can modify it in `app.js` as you wish.

After you resovled the environment, just run
```
npm start
or
node app.js
```
and the project should be running.
### Other information
- Everything is defined in app.js, just use it.
- The default port is 8088, the log file is `server.log`
- And this project offers two shell scripts to start (in background) and stop nodejs server
