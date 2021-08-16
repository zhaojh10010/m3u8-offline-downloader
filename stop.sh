#!/bin/bash
mainjs="app.js"
#mainjs="app_multi_thread.js"
nodepid=`ps -ef | grep "node $mainjs" | awk 'NR==2{print $2}'`
kill -9 $nodepid
