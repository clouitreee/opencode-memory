export interface Env {
  GITHUB_REPO: string;
  DEFAULT_REF: string;
}

const SCRIPTS: Record<string, string> = {
  install: 'scripts/install.sh',
  uninstall: 'scripts/uninstall.sh',
  verify: 'scripts/verify.sh',
};

async function fetchScript(repo: string, script: string, ref: string): Promise<Response> {
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${script}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'opencode-memory-installer/1.0',
      },
    });
    
    if (!response.ok) {
      return new Response(
        `Error: Failed to fetch script from GitHub (${response.status})\n` +
        `URL: ${url}\n` +
        `Status: ${response.statusText}\n`,
        {
          status: 502,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
          },
        }
      );
    }
    
    const content = await response.text();
    
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Ref-Used': ref,
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    return new Response(
      `Error: Unable to reach GitHub\n` +
      `Details: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
      {
        status: 502,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
        },
      }
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\//, '');
    
    const refOverride = url.searchParams.get('ref');
    const ref = refOverride || env.DEFAULT_REF;
    
    switch (path) {
      case 'install':
        return fetchScript(env.GITHUB_REPO, SCRIPTS.install, ref);
        
      case 'uninstall':
        return fetchScript(env.GITHUB_REPO, SCRIPTS.uninstall, ref);
        
      case 'verify':
        return fetchScript(env.GITHUB_REPO, SCRIPTS.verify, ref);
        
      case 'health':
        return new Response('OK', {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Ref-Used': ref,
          },
        });
        
      case '':
      case 'index.html':
        return new Response(
          'opencode-memory installer\n' +
          '\n' +
          'Usage:\n' +
          '  curl -fsSL https://i.longmem.workers.dev/install | bash\n' +
          '  curl -fsSL https://i.longmem.workers.dev/uninstall | bash\n' +
          '  curl -fsSL https://i.longmem.workers.dev/verify | bash\n' +
          '\n' +
          'Options:\n' +
          '  ?ref=<tag|sha>  Pin to specific version\n' +
          '\n' +
          'Examples:\n' +
          '  curl -fsSL "https://i.longmem.workers.dev/install?ref=v0.1.0" | bash\n',
          {
            status: 200,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'X-Ref-Used': ref,
            },
          }
        );
        
      default:
        return new Response(
          `Not Found: ${path}\n` +
          '\n' +
          'Available endpoints:\n' +
          '  /install   - Installation script\n' +
          '  /uninstall - Uninstallation script\n' +
          '  /verify    - Verification script\n' +
          '  /health    - Health check\n',
          {
            status: 404,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
            },
          }
        );
    }
  },
};
