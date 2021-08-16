#!/bin/bash
dir="/home/ffmpeg"
logfile="server.log"
#logfile="server-dev.log"
if [ ! -d "$dir" ]; then
  mkdir -p $dir
fi

if [ ! -f "$dir/$logfile" ]; then
  touch $dir/$logfile
  #chown 1000:1000 $dir/$logfile
fi

nohup npm start >> $dir/$logfile 2>&1 &
#nohup npm run dev >> $dir/$logfile 2>&1 &