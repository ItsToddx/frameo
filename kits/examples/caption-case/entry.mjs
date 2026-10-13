// SPDX-License-Identifier: Apache-2.0
export function register(api) {
  api.registerEditTool({
    descriptor: {
      id: 'example.caption-case.apply', name: 'Caption case', kind: 'edit',
      description: 'Propose upper- or lowercase text for selected captions. Read the current sequence first.',
      permissions: ['project.read', 'project.propose'],
      inputSchema: {type: 'object', properties: {
        captionIds: {type: 'array', items: {type: 'string'}, minItems: 1, maxItems: 100, uniqueItems: true},
        textCase: {enum: ['upper', 'lower']}
      }, required: ['captionIds', 'textCase'], additionalProperties: false},
      outputSchema: {type: 'object', properties: {
        sequenceId: {type: 'string'}, expectedRevision: {type: 'integer', minimum: 0},
        commands: {type: 'array', items: {type: 'object'}, minItems: 1, maxItems: 100}, title: {type: 'string'}
      }, required: ['sequenceId', 'expectedRevision', 'commands', 'title'], additionalProperties: false}
    },
    async propose(input, context) {
      context.signal.throwIfAborted();
      const sequence = context.snapshot.sequences.find(sequence => sequence.id === context.sequenceId);
      if (!sequence || sequence.revision !== context.revision) throw new Error('Read the current sequence before editing captions');
      const selected = sequence.captions.filter(caption => input.captionIds.includes(caption.id));
      if (selected.length !== input.captionIds.length) throw new Error('A selected caption no longer exists');
      return {sequenceId: sequence.id, expectedRevision: sequence.revision,
        title: `Make captions ${input.textCase === 'upper' ? 'uppercase' : 'lowercase'}`,
        commands: selected.map(caption => ({type: 'upsertCaption', caption: {...caption,
          text: input.textCase === 'upper' ? caption.text.toUpperCase() : caption.text.toLowerCase()}}))};
    }
  });
}
