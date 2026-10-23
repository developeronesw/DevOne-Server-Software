// Curated source-first DevOne software catalog.
// Items are discoverable catalog entries, NOT installed application instances.
// WordPress and the DevOne CMS local preview have dedicated managed installers; remaining catalog entries are planning references.
export type CatalogEntry={
 id:string;name:string;category:"cms"|"framework"|"platform"|"runtime";
 description:string;sourceUrl:string;docsUrl:string;runtime:string[];
 latestKnownVersion?:string;verifiedAt?:string;featured?:boolean;
 deployment:"local-node"|"php-database"|"node-app"|"python-app"|"static-build"|"container";
 releaseChannel:"stable"|"preview"|"rolling";
};
export const softwareCatalog:ReadonlyArray<CatalogEntry>=[
 {id:"devone-cms-v2",name:"DevOne CMS v2",category:"cms",description:"Developer One's proprietary PHP-free CMS. Local TypeScript/Node edition and Cloudflare Workers edition.",sourceUrl:"https://github.com/developeronesw/DevOneCMS-v2",docsUrl:"https://github.com/developeronesw/DevOneCMS-v2/blob/main/README.md",runtime:["Node.js","TypeScript","local database adapter or Cloudflare D1/KV/R2"],latestKnownVersion:"2.0.0-alpha.4",verifiedAt:"2026-10-23",featured:true,deployment:"local-node",releaseChannel:"preview"},
 {id:"wordpress",name:"WordPress",category:"cms",description:"Open-source PHP content management and publishing platform.",sourceUrl:"https://wordpress.org/download/",docsUrl:"https://wordpress.org/documentation/article/how-to-install-wordpress/",runtime:["PHP","MySQL or MariaDB","NGINX or Apache"],latestKnownVersion:"7.1.3",verifiedAt:"2026-10-14",featured:true,deployment:"php-database",releaseChannel:"stable"},
 {id:"ghost",name:"Ghost",category:"cms",description:"Publishing and memberships for modern websites.",sourceUrl:"https://github.com/TryGhost/Ghost",docsUrl:"https://ghost.org/docs/install/",runtime:["Node.js","MySQL","NGINX"],deployment:"node-app",releaseChannel:"stable"},
 {id:"strapi",name:"Strapi",category:"cms",description:"TypeScript headless CMS with customizable content APIs.",sourceUrl:"https://github.com/strapi/strapi",docsUrl:"https://docs.strapi.io/",runtime:["Node.js","Database"],deployment:"node-app",releaseChannel:"stable"},
 {id:"directus",name:"Directus",category:"cms",description:"Visual data studio and REST/GraphQL layer over SQL.",sourceUrl:"https://github.com/directus/directus",docsUrl:"https://docs.directus.io/",runtime:["Node.js","SQL database"],deployment:"node-app",releaseChannel:"stable"},
 {id:"payload",name:"Payload CMS",category:"cms",description:"Code-first TypeScript CMS and application backend.",sourceUrl:"https://github.com/payloadcms/payload",docsUrl:"https://payloadcms.com/docs",runtime:["Node.js","Database"],deployment:"node-app",releaseChannel:"stable"},
 {id:"nextjs",name:"Next.js",category:"framework",description:"Full-stack React web application framework.",sourceUrl:"https://github.com/vercel/next.js",docsUrl:"https://nextjs.org/docs",runtime:["Node.js"],deployment:"node-app",releaseChannel:"stable"},
 {id:"nuxt",name:"Nuxt",category:"framework",description:"Full-stack Vue applications with server and static targets.",sourceUrl:"https://github.com/nuxt/nuxt",docsUrl:"https://nuxt.com/docs",runtime:["Node.js"],deployment:"node-app",releaseChannel:"stable"},
 {id:"astro",name:"Astro",category:"framework",description:"Content-driven websites with islands and static output.",sourceUrl:"https://github.com/withastro/astro",docsUrl:"https://docs.astro.build/",runtime:["Node.js"],deployment:"static-build",releaseChannel:"stable"},
 {id:"sveltekit",name:"SvelteKit",category:"framework",description:"Svelte application framework for web services and sites.",sourceUrl:"https://github.com/sveltejs/kit",docsUrl:"https://svelte.dev/docs/kit",runtime:["Node.js"],deployment:"node-app",releaseChannel:"stable"},
 {id:"vite-react",name:"React + Vite",category:"framework",description:"Fast React SPA starter and modern build tool.",sourceUrl:"https://github.com/vitejs/vite",docsUrl:"https://vite.dev/guide/",runtime:["Node.js"],deployment:"static-build",releaseChannel:"stable"},
 {id:"nestjs",name:"NestJS",category:"framework",description:"TypeScript framework for backend services.",sourceUrl:"https://github.com/nestjs/nest",docsUrl:"https://docs.nestjs.com/",runtime:["Node.js"],deployment:"node-app",releaseChannel:"stable"},
 {id:"express",name:"Express",category:"framework",description:"Minimal Node.js server and API framework.",sourceUrl:"https://github.com/expressjs/express",docsUrl:"https://expressjs.com/",runtime:["Node.js"],deployment:"node-app",releaseChannel:"stable"},
 {id:"laravel",name:"Laravel",category:"framework",description:"PHP framework for application backends.",sourceUrl:"https://github.com/laravel/laravel",docsUrl:"https://laravel.com/docs",runtime:["PHP","Composer","Database"],deployment:"php-database",releaseChannel:"stable"},
 {id:"django",name:"Django",category:"framework",description:"Python framework with integrated ORM and admin.",sourceUrl:"https://github.com/django/django",docsUrl:"https://docs.djangoproject.com/",runtime:["Python","Database"],deployment:"python-app",releaseChannel:"stable"},
 {id:"fastapi",name:"FastAPI",category:"framework",description:"Typed Python APIs and automatic OpenAPI documentation.",sourceUrl:"https://github.com/fastapi/fastapi",docsUrl:"https://fastapi.tiangolo.com/",runtime:["Python"],deployment:"python-app",releaseChannel:"stable"},
 {id:"docker",name:"Docker Engine",category:"platform",description:"Application container engine and compose workloads.",sourceUrl:"https://github.com/moby/moby",docsUrl:"https://docs.docker.com/engine/",runtime:["Docker"],deployment:"container",releaseChannel:"stable"},
 {id:"nodejs",name:"Node.js",category:"runtime",description:"JavaScript and TypeScript server runtime.",sourceUrl:"https://github.com/nodejs/node",docsUrl:"https://nodejs.org/en/learn",runtime:["Node.js"],deployment:"node-app",releaseChannel:"stable"},
 {id:"python",name:"Python",category:"runtime",description:"Python application runtime and package ecosystem.",sourceUrl:"https://github.com/python/cpython",docsUrl:"https://docs.python.org/3/",runtime:["Python"],deployment:"python-app",releaseChannel:"stable"},
 {id:"php",name:"PHP",category:"runtime",description:"PHP application runtime required by WordPress and Laravel.",sourceUrl:"https://github.com/php/php-src",docsUrl:"https://www.php.net/manual/en/",runtime:["PHP"],deployment:"php-database",releaseChannel:"stable"}
];
export function listCatalog(){
 return {items:softwareCatalog,checkedAt:"2026-10-14",installMode:"planning-only",installAvailable:false,notice:"Versions are last verified references, not live release checks. WordPress and the DevOne CMS local preview are available in Install an app for Owners. Other catalog products remain planning-only. Review upstream releases and prerequisites."};
}
