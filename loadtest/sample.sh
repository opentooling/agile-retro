#!/bin/sh
# Sample the app's and Postgres's CPU and memory from their cgroups every 5 s,
# for clusters without metrics-server. Writes CSV to stdout until killed:
#   time,app_cpu_cores,app_mem_mb,pg_cpu_cores,pg_mem_mb
CTX=${KUBE_CONTEXT:-kind-metalx}
NS=${NAMESPACE:-agile-retro}
k() { kubectl --context "$CTX" -n "$NS" "$@"; }
APP=$(k get pod -l app.kubernetes.io/name=agile-retro -o jsonpath='{.items[0].metadata.name}')
PG=$(k get pod -o name | grep postgres | head -1 | cut -d/ -f2)
read_cg() { k exec "$1" -- sh -c 'echo $(grep usage_usec /sys/fs/cgroup/cpu.stat | cut -d" " -f2) $(cat /sys/fs/cgroup/memory.current)' 2>/dev/null; }
echo "time,app_cpu_cores,app_mem_mb,pg_cpu_cores,pg_mem_mb"
set -- $(read_cg "$APP"); a_prev=$1
set -- $(read_cg "$PG");  p_prev=$1
t_prev=$(date +%s)
while :; do
  sleep 5
  set -- $(read_cg "$APP"); a_cpu=$1; a_mem=$2
  set -- $(read_cg "$PG");  p_cpu=$1; p_mem=$2
  t=$(date +%s); dt=$((t - t_prev))
  awk -v t="$t" -v ac="$a_cpu" -v ap="$a_prev" -v am="$a_mem" -v pc="$p_cpu" -v pp="$p_prev" -v pm="$p_mem" -v dt="$dt" \
    'BEGIN { printf "%s,%.2f,%.0f,%.2f,%.0f\n", t, (ac-ap)/1e6/dt, am/1048576, (pc-pp)/1e6/dt, pm/1048576 }'
  a_prev=$a_cpu; p_prev=$p_cpu; t_prev=$t
done
