const render = () => html`<div class="chip"><slot name="icon"></slot><slot></slot><slot name="${dynamic}"></slot><slot name='trailing'></slot></div>`;
