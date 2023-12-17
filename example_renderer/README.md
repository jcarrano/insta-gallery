# Example for loading the gallery dynamically

## Description

This will load the gallery by parsing the JSON stored in R2 and inserting it into the DOM.

To make it even better, it uses poptrox to display the images in a lightbox.

You will have to set the "data-gallery-r2" attribute of the element that will contain the gallery to
the name of the subdomain where the gallery is hosted.

## Alternatives

You could have a worker that generates the gallery on the fly, or one that
pre-generates the gallery HTML when the gallery is updated.

Then you could either serve the HTML as a page or embed it via an iframe.

I decided to leave out the rendering code from the worker because there are many
ways to do it and any sufficiently custimizable solutio would be far too complex.

## Videos on Poptrox

"Official" poptrox does not support videos, so I'm using my own fork. See
https://github.com/jcarrano/jquery.poptrox .
