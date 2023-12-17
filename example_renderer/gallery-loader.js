
function setupPoptrox($g) {
    $g.poptrox({
        caption: function ($a) {
            var s = '';

            $a.siblings("figcaption").each(function () {
                s += this.innerHTML;
            });

            return s;
        },
        usePopupCaption: true,
        usePopupNav: true,
        selector: 'a.gallery-item',
        videoAutoplay: true,
        baseZIndex: 10000
    });
};


function instaGalleryLoader(parentElement) {
    let galleryR2 = parentElement.attr("data-gallery-r2");
    let maxEntries = parentElement.attr("gallery-max-items");
    if (maxEntries) {
        maxEntries = parseInt(maxEntries);
    } else {
        maxEntries = 50;
    }

    $.getJSON({
        url: galleryR2 + '/gallery.json',
        method: 'GET',
        success: function (data) {
            // create the gallery
            for (var i = 0; i < data.length && i < maxEntries; i++) {
                let image = data[i];

                let fig = $("<figure></figure>");
                let a = $('<a class="gallery-item"></a>');
                a.attr("href", galleryR2 + "/media-" + image.id);
                if (image.media_type == "VIDEO") {
                    a.attr("data-poptrox", "video");
                }

                fig.append(a);
                let img = $("<img></img>");
                a.append(img);
                let figcap = $("<figcaption></figcaption>");
                fig.append(figcap);
                figcap.text(image.caption);

                let link = $("<a></a>");
                link.attr("href", image.permalink);
                link.attr("target", "_blank");
                link.addClass("external-link");
                figcap.append(link);

                let thumb_url_prefix = image.media_type == "VIDEO" ? "/thumb-" : "/media-";
                img.attr("src", galleryR2 + thumb_url_prefix + image.id);

                parentElement.append(fig);
            }

            setupPoptrox(parentElement);
        },
        error: function () {
            console.log("Error loading gallery data");
        }
    });
};

function instaGalleryLoadAll() {
    $(".insta-gallery").each(function () {
        instaGalleryLoader($(this));
    });
}

$(instaGalleryLoadAll);
