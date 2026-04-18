# Memory Live Smoke Checklist

Use this checklist with a real API key after launching the app locally.

## 1. Core Memory Retention

1. Start a new session.
2. Tell the agent: `请用中文回答，我叫 Jack。`
3. Send one more task so the turn completes.
4. Open `Settings -> Memory` and search `中文` with scope `仅 core memory`.
5. Verify that a core memory record exists for response language and/or name.

## 2. Unified Experience Recall

1. Use workspace `A`.
2. In session A1, ask the agent to implement or explain `gateway token rotation`.
3. Wait until the assistant finishes.
4. Start a fresh session A2 in the same workspace.
5. Ask a follow-up question about `gateway token rotation`.
6. Verify that the cold-start response is aware of the earlier work without you restating it.
7. Search `gateway token rotation` in `Settings -> Memory` with scope `当前工作区`.

## 3. Cross-Workspace Recall

1. Switch to workspace `B`.
2. Start a fresh session B1.
3. Ask about `gateway token rotation`.
4. Verify that memory can still recall the relevant experience from workspace `A`.
5. Verify that the injected memory clearly标记来源 workspace，而不是假装都来自当前项目。
6. Verify that core preferences such as `请用中文回答` still apply.

## 4. Source Provenance

1. In any existing session with memory enabled, ask the agent to look up a prior decision.
2. Verify via logs or transcript that progressive memory retrieval runs before the main model response.
3. Confirm the injected memory context includes source workspace / source session markers.
4. Confirm the answer references the retrieved memory rather than asking you to restate it.

## 5. Maintenance Actions

1. Open `Settings -> Memory`.
2. Click `重建当前工作区`, then search again and confirm the expected source-scoped records return.
3. Click `清空当前工作区`, then verify该来源 workspace 的搜索结果消失，而其他来源仍在。
4. Click `清空 Core Memory`, then verify global/core search results disappear.

## 6. Non-Interactive Flows

1. Run one scheduled task in a workspace with memory enabled.
2. Verify its output becomes searchable from `Settings -> Memory`.
3. Run one remote session in a workspace with memory enabled.
4. Verify the same search and cold-start recall behavior works there too.
