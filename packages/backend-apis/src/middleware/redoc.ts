import { Request, Response, NextFunction } from 'express';

interface RedocOptions {
  title: string;
  spec: any;
  theme?: any;
}

export function redocMiddleware(options: RedocOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>${options.title}</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
      body { 
        margin: 0; 
        padding: 0; 
        font-family: 'Outfit', sans-serif;
      }
      /* Custom scrollbar for a premium feel */
      ::-webkit-scrollbar { width: 8px; }
      ::-webkit-scrollbar-track { background: #f1f1f1; }
      ::-webkit-scrollbar-thumb { background: #6B46C1; border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: #553C9A; }
    </style>
  </head>
  <body>
    <div id="redoc-container"></div>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"> </script>
    <script>
      Redoc.init(
        ${JSON.stringify(options.spec)},
        {
          scrollYOffset: 50,
          hideDownloadButton: false,
          nativeScrollbars: true,
          theme: ${JSON.stringify(options.theme || {
            colors: {
              primary: { main: '#6B46C1' },
              success: { main: '#38A169' },
              warning: { main: '#D69E2E' },
              error: { main: '#E53E3E' },
              text: { primary: '#2D3748', secondary: '#718096' }
            },
            typography: {
              fontSize: '15px',
              fontFamily: 'Outfit, sans-serif',
              headings: {
                fontFamily: 'Outfit, sans-serif',
                fontWeight: '700',
              },
            }
          })}
        },
        document.getElementById('redoc-container')
      );
    </script>
  </body>
</html>`;
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (error) {
      next(error);
    }
  };
}
