import asyncio
from pod import WorkerPod


class ClusterEngine:

    def __init__(self, pod_count: int) -> None:
        self.pod_cluster: dict[str, WorkerPod] = {}
        self.active_tasks: dict[str, asyncio.Task] = {}

        for _ in range(pod_count):
            pod = WorkerPod()
            self.add_pod(pod.id, pod)

    def add_pod(self, pod_id: str, pod_worker: WorkerPod) -> None:
        print(f"[added]->{pod_id}")
        self.pod_cluster[pod_id] = pod_worker

    def get_pod(self, pod_id: str) -> WorkerPod:
        return self.pod_cluster[pod_id]

    async def start_pod(self, pod_id: str) -> None:
        print(f"[started]->{pod_id}")
        # Run worker loop in background task so it doesn't block caller
        task = asyncio.create_task(
            self.pod_cluster[pod_id].start(), name=f"task-{pod_id}"
        )
        self.active_tasks[pod_id] = task

    async def start_all(self) -> None:
        # Start all pods concurrently without blocking each other
        for pod_id in list(self.pod_cluster.keys()):
            await self.start_pod(pod_id)

    async def stop_pod(self, pod_id: str) -> None:
        print(f"[stopping]->{pod_id}")
        pod = self.pod_cluster.get(pod_id)
        if pod:
            await pod.stop()

        # Cancel underlying task if still active
        task = self.active_tasks.get(pod_id)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def stop_all(self) -> None:
        # Stop all pods concurrently
        stop_signals = [self.stop_pod(pod_id) for pod_id in self.pod_cluster.keys()]
        await asyncio.gather(*stop_signals, return_exceptions=True)

    def remove_pod(self, pod_id: str) -> None:
        if pod_id in self.pod_cluster:
            del self.pod_cluster[pod_id]
        if pod_id in self.active_tasks:
            del self.active_tasks[pod_id]
async def main():
    clust = ClusterEngine(2)
    await clust.start_all()
    
    
asyncio.run(main())