#!/bin/bash
mypid=`ps -ef | grep node | awk 'NR==2{print $2}'`
kill -9 $mypid
