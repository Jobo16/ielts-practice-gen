
(function (global) {
  'use strict';

  function instructionInlines(task) {
    if (Array.isArray(task.instructionInlines) && task.instructionInlines.length === (task.instructions || []).length) {
      return task.instructionInlines;
    }
    return (task.instructions || []).map((text) => [{ style: 'text', text }]);
  }

  function formattingRuns(text, sourceFormatting) {
    const source = String(text || '');
    const cues = [
      ...(sourceFormatting?.italicText || []).map((value) => ({ value, style: 'em' })),
      ...(sourceFormatting?.boldText || []).map((value) => ({ value, style: 'strong' })),
    ].filter(({ value }) => typeof value === 'string' && value);
    if (!cues.length) return [{ style: 'text', text: source }];
    const ranges = [];
    for (const cue of cues) {
      let cursor = 0;
      while (cursor < source.length) {
        const index = source.indexOf(cue.value, cursor);
        if (index < 0) break;
        ranges.push({ start: index, end: index + cue.value.length, ...cue });
        cursor = index + cue.value.length;
      }
    }
    ranges.sort((left, right) => left.start - right.start || right.end - right.start - (left.end - left.start));
    const accepted = ranges.filter((range, index, all) => !all.slice(0, index)
      .some((candidate) => range.start < candidate.end && range.end > candidate.start));
    if (!accepted.length) return [{ style: 'text', text: source }];
    const runs = [];
    let cursor = 0;
    for (const range of accepted) {
      if (range.start > cursor) runs.push({ style: 'text', text: source.slice(cursor, range.start) });
      runs.push({ style: range.style, text: source.slice(range.start, range.end) });
      cursor = range.end;
    }
    if (cursor < source.length) runs.push({ style: 'text', text: source.slice(cursor) });
    return runs;
  }

  function taskItemFormatting(task, itemId) {
    return (task?.extensions?.sourceFormatting?.taskItems || [])
      .find((record) => record?.itemId === itemId) || null;
  }

  function adaptTaskItem(item, displayNumber, sourceFormatting = null, completionTitle = '') {
    const extensions = { ...(item.extensions || {}) };
    if (normalizedDisplayText(extensions.summarySectionTitle)
      && normalizedDisplayText(extensions.summarySectionTitle) === normalizedDisplayText(completionTitle)) {
      // Some legacy option-Summary packages repeat the task's main title as
      // the first subsection title. Suppress only that redundant presentation
      // field while preserving the item id, inlines and all other extensions.
      delete extensions.summarySectionTitle;
    }
    return {
      itemId: item.itemId,
      text: item.text || '',
      textInlines: (item.textInlines || formattingRuns(item.text || '', sourceFormatting)).map((run) => ({ ...run })),
      extensions,
      responseSlotIds: [...(item.responseSlotIds || [])],
      questionNumbers: (item.responseSlotIds || []).map(displayNumber).filter(Number.isFinite),
      inlines: (item.inlines || []).map((inline) => ({ ...inline })),
      options: (item.options || []).map((option) => ({
        id: option.optionId || option.id,
        text: option.text || option.label || option.optionId || option.id,
      })),
    };
  }

  function adaptTable(table) {
    if (!table) return null;
    return {
      caption: table.caption || '',
      columnCount: Number(table.columnCount),
      columnWidths: (table.columnWidths || []).map(Number),
      readingOrder: [...(table.readingOrder || [])],
      rows: (table.rows || []).map((row) => ({
        rowId: row.rowId,
        extensions: row.extensions || {},
        cells: (row.cells || []).map((cell) => ({
          cellId: cell.cellId,
          kind: cell.kind,
          text: cell.text || '',
          itemId: cell.itemId || '',
          colSpan: Number(cell.colSpan) || 1,
          rowSpan: Number(cell.rowSpan) || 1,
          scope: cell.scope || '',
          extensions: cell.extensions || {},
        })),
      })),
    };
  }

  function adaptFlowChart(flowChart) {
    if (!flowChart) return null;
    return {
      title: flowChart.title || '',
      orientation: flowChart.orientation || '',
      topology: flowChart.topology || '',
      readingOrder: [...(flowChart.readingOrder || [])],
      nodes: (flowChart.nodes || []).map((node) => ({
        nodeId: node.nodeId,
        kind: node.kind,
        text: node.text || '',
        itemId: node.itemId || '',
      })),
      edges: (flowChart.edges || []).map((edge) => ({
        edgeId: edge.edgeId,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        kind: edge.kind || '',
        branchId: edge.branchId || '',
        label: edge.label || '',
      })),
    };
  }

  function adaptAssets(sourceAssets) {
    return (sourceAssets || []).map((asset) => ({
      assetId: asset.assetId,
      mediaType: asset.mediaType || '',
      encoding: asset.encoding || '',
      data: asset.data || '',
      sha256: asset.sha256 || '',
      width: Number(asset.width) || 0,
      height: Number(asset.height) || 0,
      alt: asset.alt || '',
      longDescription: asset.longDescription || '',
    }));
  }

  function adaptBox(box) {
    if (!box) return null;
    return {
      x: Number(box.x),
      y: Number(box.y),
      width: Number(box.width),
      height: Number(box.height),
    };
  }

  function adaptLeaderLine(leader) {
    if (!leader) return null;
    return {
      lineId: leader.lineId || '',
      points: (leader.points || []).map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
      })),
      presentation: leader.presentation || '',
    };
  }

  function adaptDiagram(diagram) {
    if (!diagram) return null;
    return {
      title: diagram.title || '',
      assetId: diagram.assetId || '',
      coordinateSpace: diagram.coordinateSpace || '',
      readingOrder: [...(diagram.readingOrder || [])],
      callouts: (diagram.callouts || []).map((callout) => ({
        calloutId: callout.calloutId || '',
        box: adaptBox(callout.box),
        inlines: (callout.inlines || []).map((inline) => ({ ...inline })),
        leaderLines: (callout.leaderLines || []).map(adaptLeaderLine),
        spatialDescription: callout.spatialDescription || '',
      })),
      anchors: (diagram.anchors || []).map((anchor) => ({
        anchorId: anchor.anchorId || '',
        calloutId: anchor.calloutId || '',
        itemId: anchor.itemId || '',
        responseSlotId: anchor.responseSlotId || '',
        featurePoint: {
          x: Number(anchor.featurePoint?.x),
          y: Number(anchor.featurePoint?.y),
        },
      })),
      fixedLabels: (diagram.fixedLabels || []).map((label) => ({
        fixedLabelId: label.fixedLabelId || '',
        text: label.text || '',
        box: adaptBox(label.box),
        presentation: label.presentation || '',
      })),
    };
  }

  function normalizedDisplayText(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[‘’]/gu, "'")
      .replace(/[“”]/gu, '"')
      .replace(/[–—]/gu, '-')
      .replace(/\s+/gu, ' ')
      .trim()
      .toLocaleLowerCase('en-US');
  }

  function adapt(candidate, registry) {
    if (!candidate || !Array.isArray(candidate.parts) || !Array.isArray(candidate.responseSlots)) {
      throw new Error('A v2 candidate with parts and responseSlots is required.');
    }
    if (!registry || typeof registry.require !== 'function') throw new Error('An explicit question type registry is required.');

    const responseSlots = new Map(candidate.responseSlots.map((slot) => [slot.responseSlotId, slot]));
    const assets = adaptAssets(candidate.assets);
    const displayNumber = (responseSlotId) => Number(responseSlots.get(responseSlotId)?.displayNumber);

    return candidate.parts.map((sourcePart) => {
      const passage = sourcePart.passage || {};
      const blocks = passage.blocks || [];
      const passageBlocks = blocks.filter((block) => block.type !== 'footnote');
      const normalizedLead = normalizedDisplayText(passage.lead);
      let leadingStandfirstText = '';
      let leadDuplicatesStandfirst = false;
      for (const block of passageBlocks) {
        if (block.type !== 'standfirst') break;
        leadingStandfirstText = `${leadingStandfirstText} ${block.text || ''}`.trim();
        if (normalizedLead && normalizedDisplayText(leadingStandfirstText) === normalizedLead) {
          leadDuplicatesStandfirst = true;
          break;
        }
      }
      const part = {
        partId: sourcePart.partId,
        passageId: passage.passageId || '',
        number: Number(sourcePart.ordinal),
        label: sourcePart.label || `READING PASSAGE ${sourcePart.ordinal}`,
        instruction: sourcePart.instruction || '',
        sourceInstruction: '',
        title: passage.title || '',
        reportPresentation: sourcePart.extensions?.reportPresentation || null,
        difficultyTier: sourcePart.extensions?.reportPresentation?.difficultyTier || null,
        titleVisible: passage.extensions?.sourceFormatting?.sourceTitleVisible !== false,
        // Legacy authoring may preserve the same standfirst in passage.lead
        // and in one or more leading semantic blocks. Keep the blocks (their
        // ids and source formatting are authoritative) and suppress only the
        // redundant header copy.
        lead: leadDuplicatesStandfirst ? '' : passage.lead || '',
        paragraphs: passageBlocks.map((block) => ({
          blockId: block.blockId,
          label: block.label || '',
          text: block.text || '',
          extensions: block.extensions || {},
          role: block.type === 'heading' ? 'source-title' : block.type === 'standfirst' ? 'standfirst' : block.role || 'body',
        })),
        footnotes: blocks.filter((block) => block.type === 'footnote').map((block) => ({
          blockId: block.blockId,
          text: block.text || '',
          extensions: block.extensions || {},
        })),
        disclaimer: [],
        assets,
        groups: [],
      };

      (sourcePart.tasks || []).forEach((task) => {
        const definition = registry.require(task);
        const options = (task.content?.options || []).map((option) => ({
          id: option.optionId,
          label: option.label || '',
          text: option.text || option.label || option.optionId,
          detail: option.detail || '',
          sourceBlockId: option.sourceBlockId || '',
        }));
        const targets = new Map((task.content?.targets || []).map((target) => [target.targetId, target]));
        const numbers = task.responseSlotIds.map(displayNumber).filter(Number.isFinite);
        const first = Math.min(...numbers);
        const last = Math.max(...numbers);
        const range = numbers.length ? (first === last ? String(first) : `${first}–${last}`) : '';
        const contentItems = task.content?.items || [];
        const sections = (task.content?.sections || []).map((section) => ({
          sectionId: section.sectionId,
          label: section.label || '',
          items: (section.items || []).map((item) => ({
            itemId: item.itemId,
            text: item.text || '',
            role: item.role || '',
            extensions: item.extensions || {},
            responseSlotIds: [...(item.responseSlotIds || [])],
            questionNumbers: (item.responseSlotIds || []).map(displayNumber).filter(Number.isFinite),
            textInlines: (item.textInlines || [{ style: 'text', text: item.text || '' }]).map((run) => ({ ...run })),
            inlines: item.inlines || [],
          })),
        }));
        const itemForResponse = (responseSlotId) => {
          const direct = contentItems.find((item) => (item.responseSlotIds || []).includes(responseSlotId));
          if (direct) return direct;
          for (const section of task.content?.sections || []) {
            const item = (section.items || []).find((candidateItem) => (candidateItem.responseSlotIds || []).includes(responseSlotId));
            if (item) return item;
          }
          return null;
        };
        const group = {
          id: task.taskId,
          taskId: task.taskId,
          part: part.number,
          rendererId: definition.rendererId,
          questionType: task.questionType,
          interactionVariant: task.interactionVariant,
          layoutVariant: task.layoutVariant,
          v2Task: task,
          range,
          heading: task.heading || (range ? `Questions ${range}` : ''),
          instructions: [...(task.instructions || [])],
          instructionInlines: instructionInlines(task),
          instructionProfile: task.instructionProfile || null,
          responseConstraint: task.rules?.wordLimit?.sourceText || '',
          rules: task.rules || {},
          completionTitle: task.content?.listTitle || '',
          reuse: task.rules?.optionReuse || 'not-applicable',
          listTitle: task.content?.listTitle || '',
          stem: task.content?.stem || '',
          stemInlines: task.content?.stemInlines || [{ style: 'text', text: task.content?.stem || '' }],
          contextParagraphs: (task.content?.contextParagraphs || []).map((paragraph) => ({
            text: paragraph.text || '',
            inlines: (paragraph.inlines || [{ style: 'text', text: paragraph.text || '' }])
              .map((run) => ({ ...run })),
          })),
          options,
          choices: options,
          headings: options,
          responseSlotIds: [...task.responseSlotIds],
          targets,
          mapping: task.content?.mapping || null,
          contentItems: contentItems.map((item) => adaptTaskItem(
            item,
            displayNumber,
            taskItemFormatting(task, item.itemId),
            task.content?.listTitle || '',
          )),
          sections,
          table: adaptTable(task.content?.table),
          flowChart: adaptFlowChart(task.content?.flowChart),
          diagram: adaptDiagram(task.content?.diagram),
          assets,
          items: [],
        };

        group.items = task.responseSlotIds.map((responseSlotId) => {
          const slot = responseSlots.get(responseSlotId);
          const target = slot?.targetId ? targets.get(slot.targetId) : null;
          const item = itemForResponse(responseSlotId);
          const adaptedItem = item ? adaptTaskItem(
            item,
            displayNumber,
            taskItemFormatting(task, item.itemId),
            task.content?.listTitle || '',
          ) : null;
          return {
            itemId: item?.itemId || `runtime-item.${responseSlotId}`,
            number: Number(slot?.displayNumber),
            responseSlotId,
            targetId: slot?.targetId || item?.targetId || '',
            targetType: target?.targetType || '',
            targetItemId: target?.itemId || '',
            fieldId: target?.fieldId || '',
            responseFieldId: slot?.fieldId || '',
            blockId: target?.blockId || '',
            nodeId: target?.nodeId || '',
            anchorId: target?.anchorId || '',
            assetId: target?.assetId || '',
            prompt: item?.text || target?.label || task.content?.stem || '',
            promptInlines: (adaptedItem?.textInlines || [{ style: 'text', text: item?.text || target?.label || task.content?.stem || '' }])
              .map((run) => ({ ...run })),
          };
        }).filter((item) => Number.isFinite(item.number));
        part.groups.push(group);
      });
      return part;
    }).sort((a, b) => a.number - b.number);
  }

  global.IELTSV2CandidateAdapter = Object.freeze({ adapt });
})(window);

    