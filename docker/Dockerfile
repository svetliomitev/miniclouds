FROM php:8.3-apache

# Enable Apache modules required by .htaccess
RUN a2enmod rewrite headers

# Copy MiniCloudS source into the image (read-only seed)
WORKDIR /opt/miniclouds-src
COPY . /opt/miniclouds-src/

# Entrypoint handles first-run init into a named volume
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]