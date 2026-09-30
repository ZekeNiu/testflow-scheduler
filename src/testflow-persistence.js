  // Persist the in-progress editor state as well as the last valid plan.
  const DRAFT_STORAGE='testflow-plan-draft-v1';
  function saveEditDraft(showStatus=true){
    try{
      localStorage.setItem(DRAFT_STORAGE,JSON.stringify({version:1,savedAt:Date.now(),state,drafts:[...drafts],timeErrors:[...timeErrors]}));
      if(showStatus)$('#storage-status').textContent=checked?.result?'已自动保存':'草稿已自动保存';
      return true;
    }catch{
      if(showStatus)$('#storage-status').textContent='可保存方案备份';
      return false;
    }
  }
  function restoreEditDraft(){
    try{
      const saved=JSON.parse(localStorage.getItem(DRAFT_STORAGE)||'null'),candidate=saved?.state;
      if(saved?.version!==1||!candidate||candidate.version!==4||candidate.timeUnit!=='sec'||!['sec','mixed'].includes(candidate.format)||!Array.isArray(candidate.stations)||!candidate.stations.length||candidate.stations.length>20||!Array.isArray(candidate.breaks))return false;
      state=candidate;
      drafts.clear();
      if(Array.isArray(saved.drafts))for(const entry of saved.drafts){if(Array.isArray(entry)&&entry.length===2&&typeof entry[0]==='string'&&entry[1]&&typeof entry[1]==='object')drafts.set(entry[0],entry[1]);}
      timeErrors.clear();
      if(Array.isArray(saved.timeErrors))for(const entry of saved.timeErrors){if(Array.isArray(entry)&&entry.length===2&&typeof entry[0]==='string'&&entry[1]&&typeof entry[1]==='object')timeErrors.set(entry[0],entry[1]);}
      return true;
    }catch{return false;}
  }
  const recalculateWithoutDraftSave=recalculate;
  recalculate=function(){
    const result=recalculateWithoutDraftSave();
    saveEditDraft(true);
    return result;
  };
  if(restoreEditDraft()){
    expandedStations.clear();expandedStations.add(0);arrivalPage=0;capacityTargets.clear();undoSnapshot=null;personStart=1;detailPage=0;filterStation=filterPerson='';zoom=1;
    renderStations();renderBreaks();syncControls();recalculate();setSidebar(sidebarOpen);
  }
  window.addEventListener('pagehide',()=>saveEditDraft(false));
