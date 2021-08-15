#!/bin/bash
mainjs="app.js"
#mainjs="app_multi_thread.js"
nodepid=`ps -ef | grep "node $mainjs" | awk 'NR==1{print $2}'`
kill -9 $nodepid
